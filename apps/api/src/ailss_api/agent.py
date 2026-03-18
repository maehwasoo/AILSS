from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from time import perf_counter
from typing import Any, Literal, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from .config import Settings
from .models import (
    AgentFailure,
    AgentRunMetrics,
    AgentRunRequest,
    AgentRunResponse,
    Citation,
    RetrieveRequest,
    RetrieveResponse,
    RetrieveResponseMode,
    RetrieveResult,
    WorkflowStep,
    WriteAction,
)
from .observability import write_run_artifact
from .retrieval import retrieve_notes
from .retrieval_common import resolve_note_path_within_vault


class AgentGraphState(TypedDict):
    request: AgentRunRequest
    settings: Settings
    run_id: str
    workflow: list[WorkflowStep]
    retrieval: RetrieveResponse | None
    selected_results: list[RetrieveResult]
    note_excerpts: list[str | None]
    answer: str | None
    citations: list[Citation]
    failure: AgentFailure | None
    write_actions: list[WriteAction]


def run_agent_workflow(request: AgentRunRequest, settings: Settings) -> AgentRunResponse:
    started = perf_counter()
    run_id = f"run_{uuid4().hex[:12]}"
    graph = _get_agent_graph()
    final_state = graph.invoke(
        {
            "request": request,
            "settings": settings,
            "run_id": run_id,
            "workflow": [],
            "retrieval": None,
            "selected_results": [],
            "note_excerpts": [],
            "answer": None,
            "citations": [],
            "failure": None,
            "write_actions": [],
        }
    )

    retrieval = final_state["retrieval"]
    metrics = AgentRunMetrics(
        latency_ms=round((perf_counter() - started) * 1000, 3),
        retrieval_latency_ms=round(retrieval.usage.latency_ms if retrieval else 0.0, 3),
        retrieval_mode=_resolve_metrics_mode(request, retrieval),
        selected_notes=len(final_state["selected_results"]),
        embedding_prompt_tokens=retrieval.usage.embedding_prompt_tokens if retrieval else None,
    )
    response = AgentRunResponse(
        run_id=run_id,
        outcome="failed" if final_state["failure"] else "completed",
        answer=final_state["answer"],
        citations=final_state["citations"],
        workflow=final_state["workflow"],
        failure=final_state["failure"],
        write_actions=final_state["write_actions"],
        metrics=metrics,
    )
    artifact_path = write_run_artifact(
        settings=settings,
        run_id=run_id,
        payload={
            "request": request.model_dump(),
            "response": response.model_dump(),
        },
    )
    return response.model_copy(update={"artifact_path": artifact_path})


@lru_cache(maxsize=1)
def _get_agent_graph() -> Any:
    graph = StateGraph(AgentGraphState)
    graph.add_node("guard_write", _guard_write_request)
    graph.add_node("retrieve_context", _retrieve_context)
    graph.add_node("decide_context", _decide_context)
    graph.add_node("read_notes", _read_selected_notes)
    graph.add_node("build_answer", _build_answer)
    graph.add_node("validate_answer", _validate_answer)

    graph.add_edge(START, "guard_write")
    graph.add_conditional_edges("guard_write", _route_after_guard)
    graph.add_edge("retrieve_context", "decide_context")
    graph.add_conditional_edges("decide_context", _route_after_decide)
    graph.add_edge("read_notes", "build_answer")
    graph.add_conditional_edges("build_answer", _route_after_answer)
    graph.add_edge("validate_answer", END)
    return graph.compile()


def _guard_write_request(state: AgentGraphState) -> dict[str, object]:
    request = state["request"]
    if request.requested_write_action and not request.apply:
        failure = AgentFailure(
            code="apply_not_requested",
            message="A write action was requested without apply=true.",
        )
        return {
            "failure": failure,
            "workflow": _append_step(
                state["workflow"],
                "decide",
                "failed",
                "write action requested without apply=true",
            ),
            "write_actions": [
                WriteAction(
                    action=request.requested_write_action,
                    allowed=False,
                    reason="apply_not_requested",
                )
            ],
        }

    if request.requested_write_action and request.apply:
        failure = AgentFailure(
            code="write_not_allowed",
            message="This baseline agent workflow does not perform writes.",
        )
        return {
            "failure": failure,
            "workflow": _append_step(
                state["workflow"],
                "decide",
                "failed",
                "write action blocked in baseline workflow",
            ),
            "write_actions": [
                WriteAction(
                    action=request.requested_write_action,
                    allowed=False,
                    reason="write_not_allowed",
                )
            ],
        }

    return {}


def _route_after_guard(state: AgentGraphState) -> Literal["retrieve_context", "__end__"]:
    if state["failure"] is not None:
        return "__end__"
    return "retrieve_context"


def _retrieve_context(state: AgentGraphState) -> dict[str, object]:
    request = state["request"]
    retrieval = retrieve_notes(
        RetrieveRequest(
            query=request.input,
            mode=request.context.retrieval_mode,
            top_k=request.context.top_k,
            path_prefix=request.context.path_prefix,
            tags_any=request.context.tags_any,
            tags_all=request.context.tags_all,
            hit_chunks_per_note=request.context.hit_chunks_per_note,
            neighbor_window=request.context.neighbor_window,
        ),
        state["settings"],
    )
    return {
        "retrieval": retrieval,
        "workflow": _append_step(
            state["workflow"],
            "retrieve",
            "completed",
            f"{len(retrieval.results)} grounded note candidates",
        ),
    }


def _decide_context(state: AgentGraphState) -> dict[str, object]:
    retrieval = state["retrieval"]
    if retrieval is None or not retrieval.results:
        failure = AgentFailure(
            code="missing_context",
            message="No local evidence matched the request.",
        )
        workflow = _append_step(state["workflow"], "decide", "failed", "no grounded context")
        workflow = _append_step(workflow, "read", "skipped", "no candidate notes")
        workflow = _append_step(workflow, "answer", "skipped", "no grounded context")
        workflow = _append_step(workflow, "validate", "skipped", "no citations")
        return {"failure": failure, "workflow": workflow}

    if _has_ambiguous_note_resolution(retrieval.results):
        failure = AgentFailure(
            code="ambiguous_note_resolution",
            message="Top retrieval candidates resolve to multiple near-identical notes.",
        )
        workflow = _append_step(
            state["workflow"],
            "decide",
            "failed",
            "ambiguous note resolution across top candidates",
        )
        workflow = _append_step(workflow, "read", "skipped", "candidate set remained ambiguous")
        workflow = _append_step(workflow, "answer", "skipped", "candidate set remained ambiguous")
        workflow = _append_step(workflow, "validate", "skipped", "no answer generated")
        return {"failure": failure, "workflow": workflow}

    selected = retrieval.results[:2]
    return {
        "selected_results": selected,
        "workflow": _append_step(
            state["workflow"],
            "decide",
            "completed",
            f"selected {len(selected)} notes for grounding",
        ),
    }


def _route_after_decide(state: AgentGraphState) -> Literal["read_notes", "__end__"]:
    if state["failure"] is not None:
        return "__end__"
    return "read_notes"


def _read_selected_notes(state: AgentGraphState) -> dict[str, object]:
    excerpts = [
        _read_note_excerpt(state["settings"], result.path) for result in state["selected_results"]
    ]
    return {
        "note_excerpts": excerpts,
        "workflow": _append_step(
            state["workflow"],
            "read",
            "completed",
            "read note files when available, otherwise used indexed evidence",
        ),
    }


def _build_answer(state: AgentGraphState) -> dict[str, object]:
    answer = _compose_answer(
        state["request"].input,
        state["selected_results"],
        state["note_excerpts"],
    )
    if not answer.strip():
        workflow = _append_step(state["workflow"], "answer", "failed", "empty grounded answer")
        workflow = _append_step(workflow, "validate", "failed", "answer missing")
        return {
            "failure": AgentFailure(
                code="grounding_failure",
                message="The workflow could not build a grounded answer.",
            ),
            "workflow": workflow,
        }

    return {
        "answer": answer,
        "workflow": _append_step(
            state["workflow"],
            "answer",
            "completed",
            "built deterministic grounded summary",
        ),
    }


def _route_after_answer(state: AgentGraphState) -> Literal["validate_answer", "__end__"]:
    if state["failure"] is not None:
        return "__end__"
    return "validate_answer"


def _validate_answer(state: AgentGraphState) -> dict[str, object]:
    citations = [
        Citation(path=result.path, chunk_id=chunk_id)
        for result in state["selected_results"]
        if (chunk_id := _select_citation_chunk_id(result)) is not None
    ]
    if not citations:
        return {
            "failure": AgentFailure(
                code="grounding_failure",
                message="The workflow produced no inspectable citations.",
            ),
            "workflow": _append_step(
                state["workflow"],
                "validate",
                "failed",
                "no evidence chunks available for citations",
            ),
        }

    return {
        "citations": citations,
        "workflow": _append_step(
            state["workflow"],
            "validate",
            "completed",
            f"{len(citations)} citations attached",
        ),
    }


def _select_citation_chunk_id(result: RetrieveResult) -> str | None:
    preferred_kinds = {"hit", "match"}
    for evidence in result.evidence:
        if evidence.kind in preferred_kinds:
            return evidence.chunk_id
    if result.evidence:
        return result.evidence[0].chunk_id
    return None


def _append_step(
    workflow: list[WorkflowStep],
    name: str,
    outcome: Literal["completed", "failed", "skipped"],
    detail: str,
) -> list[WorkflowStep]:
    return [*workflow, WorkflowStep(name=name, outcome=outcome, detail=detail)]


def _resolve_metrics_mode(
    request: AgentRunRequest,
    retrieval: RetrieveResponse | None,
) -> RetrieveResponseMode:
    if retrieval is not None:
        return retrieval.mode
    return "semantic_local" if request.context.retrieval_mode == "semantic" else "lexical_baseline"


def _has_ambiguous_note_resolution(results: Sequence[RetrieveResult]) -> bool:
    if len(results) < 2:
        return False

    first = results[0]
    second = results[1]
    first_title = (first.title or "").strip().casefold()
    second_title = (second.title or "").strip().casefold()
    if not first_title or first_title != second_title:
        return False

    if first.distance is not None and second.distance is not None:
        return abs(first.distance - second.distance) <= 0.02

    if first.score is not None and second.score is not None:
        return abs(first.score - second.score) <= 0.25

    return False


def _compose_answer(
    user_input: str,
    results: Sequence[RetrieveResult],
    note_excerpts: list[str | None],
) -> str:
    segments = [f'Local baseline answer for "{user_input}":']
    for result, note_excerpt in zip(results, note_excerpts, strict=True):
        label = result.title or result.path
        summary = result.summary or result.snippet
        evidence = note_excerpt or result.evidence_text or result.evidence[0].text
        segments.append(f"{label} ({result.path}) points to {summary}. Evidence: {evidence}")
    return " ".join(segments)


def _read_note_excerpt(settings: Settings, note_path: str) -> str | None:
    candidate = resolve_note_path_within_vault(settings, note_path)
    if candidate is None:
        return None

    try:
        text = candidate.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    excerpt = text[: settings.max_read_chars].strip()
    if len(text) > settings.max_read_chars:
        return f"{excerpt}..."
    return excerpt or None
