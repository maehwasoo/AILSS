from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from uuid import uuid4

from .config import Settings
from .models import (
    AgentFailure,
    AgentRunRequest,
    AgentRunResponse,
    Citation,
    RetrieveRequest,
    RetrieveResult,
    WorkflowStep,
    WriteAction,
)
from .retrieval import retrieve_notes


def run_agent_workflow(request: AgentRunRequest, settings: Settings) -> AgentRunResponse:
    run_id = f"run_{uuid4().hex[:12]}"
    workflow: list[WorkflowStep] = []

    if request.requested_write_action and not request.apply:
        return AgentRunResponse(
            run_id=run_id,
            outcome="failed",
            failure=AgentFailure(
                code="apply_not_requested",
                message="A write action was requested without apply=true.",
            ),
            workflow=[
                WorkflowStep(
                    name="decide",
                    outcome="failed",
                    detail="write action requested without apply=true",
                ),
            ],
            write_actions=[
                WriteAction(
                    action=request.requested_write_action,
                    allowed=False,
                    reason="apply_not_requested",
                ),
            ],
        )

    if request.requested_write_action and request.apply:
        return AgentRunResponse(
            run_id=run_id,
            outcome="failed",
            failure=AgentFailure(
                code="write_not_allowed",
                message="This baseline agent workflow does not perform writes.",
            ),
            workflow=[
                WorkflowStep(
                    name="decide",
                    outcome="failed",
                    detail="write action blocked in baseline workflow",
                ),
            ],
            write_actions=[
                WriteAction(
                    action=request.requested_write_action,
                    allowed=False,
                    reason="write_not_allowed",
                ),
            ],
        )

    retrieve_request = RetrieveRequest(
        query=request.input,
        top_k=request.context.top_k,
        path_prefix=request.context.path_prefix,
        tags_any=request.context.tags_any,
        tags_all=request.context.tags_all,
    )
    retrieval = retrieve_notes(retrieve_request, settings)
    workflow.append(
        WorkflowStep(
            name="retrieve",
            outcome="completed",
            detail=f"{len(retrieval.results)} note candidates",
        ),
    )

    if not retrieval.results:
        workflow.extend(
            [
                WorkflowStep(name="decide", outcome="failed", detail="no grounded context"),
                WorkflowStep(name="read", outcome="skipped", detail="no candidate notes"),
                WorkflowStep(name="answer", outcome="skipped", detail="no grounded context"),
                WorkflowStep(name="validate", outcome="skipped", detail="no citations"),
            ],
        )
        return AgentRunResponse(
            run_id=run_id,
            outcome="failed",
            failure=AgentFailure(
                code="missing_context",
                message="No local evidence matched the request.",
            ),
            workflow=workflow,
        )

    workflow.append(
        WorkflowStep(
            name="decide",
            outcome="completed",
            detail=f"selected {min(2, len(retrieval.results))} notes for grounding",
        ),
    )

    selected_results = retrieval.results[:2]
    note_excerpts = [_read_note_excerpt(settings, result.path) for result in selected_results]
    workflow.append(
        WorkflowStep(
            name="read",
            outcome="completed",
            detail="read note files when available, otherwise used indexed evidence",
        ),
    )

    answer = _compose_answer(request.input, selected_results, note_excerpts)
    if not answer.strip():
        workflow.extend(
            [
                WorkflowStep(name="answer", outcome="failed", detail="empty grounded answer"),
                WorkflowStep(name="validate", outcome="failed", detail="answer missing"),
            ],
        )
        return AgentRunResponse(
            run_id=run_id,
            outcome="failed",
            failure=AgentFailure(
                code="grounding_failure",
                message="The workflow could not build a grounded answer.",
            ),
            workflow=workflow,
        )

    workflow.append(
        WorkflowStep(
            name="answer",
            outcome="completed",
            detail="built deterministic grounded summary",
        ),
    )
    citations = [
        Citation(path=result.path, chunk_id=result.evidence[0].chunk_id)
        for result in selected_results
        if result.evidence
    ]
    if not citations:
        workflow.append(
            WorkflowStep(
                name="validate",
                outcome="failed",
                detail="no evidence chunks available for citations",
            ),
        )
        return AgentRunResponse(
            run_id=run_id,
            outcome="failed",
            failure=AgentFailure(
                code="grounding_failure",
                message="The workflow produced no inspectable citations.",
            ),
            workflow=workflow,
        )

    workflow.append(
        WorkflowStep(
            name="validate",
            outcome="completed",
            detail=f"{len(citations)} citations attached",
        ),
    )
    return AgentRunResponse(
        run_id=run_id,
        outcome="completed",
        answer=answer,
        citations=citations,
        workflow=workflow,
    )


def _compose_answer(
    user_input: str,
    results: Sequence[RetrieveResult],
    note_excerpts: list[str | None],
) -> str:
    segments = [
        f'Local baseline answer for "{user_input}":',
    ]
    for result, note_excerpt in zip(results, note_excerpts, strict=True):
        path = result.path
        label = result.title or path
        summary = result.summary or result.evidence[0].text
        excerpt = note_excerpt or result.evidence[0].text
        segments.append(
            f"{label} ({path}) points to {summary}. Evidence: {excerpt}",
        )
    return " ".join(segments)


def _read_note_excerpt(settings: Settings, note_path: str) -> str | None:
    vault_path = settings.resolved_vault_path
    if vault_path is None:
        return None

    candidate = vault_path / Path(note_path)
    if not candidate.exists():
        return None

    text = candidate.read_text(encoding="utf-8")
    excerpt = text[: settings.max_read_chars].strip()
    if len(text) > settings.max_read_chars:
        return f"{excerpt}..."
    return excerpt or None
