from __future__ import annotations

import json
from pathlib import Path
from statistics import median
from time import perf_counter
from uuid import uuid4

from pydantic import BaseModel, Field

from .agent import run_agent_workflow
from .config import Settings
from .models import (
    AgentRunContext,
    AgentRunRequest,
    EvalRunRequest,
    EvalRunResponse,
    EvalSummary,
    RetrieveRequest,
)
from .retrieval import retrieve_notes


class DatasetNotFoundError(RuntimeError):
    """Dataset resolution failure."""


class EvalCase(BaseModel):
    case_id: str
    input: str
    context: dict[str, object] = Field(default_factory=dict)
    expected_paths: list[str] = Field(default_factory=list)
    expected_terms: list[str] = Field(default_factory=list)


def run_eval(request: EvalRunRequest, settings: Settings) -> EvalRunResponse:
    cases = _load_dataset(settings.resolved_dataset_dir, request.dataset_id)[: request.limit]
    run_id = f"eval_{uuid4().hex[:12]}"
    latencies: list[float] = []
    retrieval_passes = 0
    agent_passes = 0
    case_reports: list[dict[str, object]] = []

    for case in cases:
        started = perf_counter()
        top_k = _coerce_int(case.context.get("top_k"), settings.default_top_k)
        path_prefix = _optional_string(case.context.get("path_prefix"))
        tags_any = _normalize_string_list(case.context.get("tags_any"))
        tags_all = _normalize_string_list(case.context.get("tags_all"))
        retrieve_request = RetrieveRequest(
            query=case.input,
            top_k=top_k,
            path_prefix=path_prefix,
            tags_any=tags_any,
            tags_all=tags_all,
        )
        retrieval = retrieve_notes(retrieve_request, settings)
        agent = run_agent_workflow(
            AgentRunRequest(
                input=case.input,
                context=AgentRunContext(
                    path_prefix=path_prefix,
                    tags_any=tags_any,
                    tags_all=tags_all,
                    top_k=top_k,
                ),
            ),
            settings,
        )
        latency_ms = (perf_counter() - started) * 1000
        latencies.append(latency_ms)

        retrieval_paths = [result.path for result in retrieval.results]
        retrieval_pass = not case.expected_paths or any(
            expected_path in retrieval_paths for expected_path in case.expected_paths
        )
        answer_text = (agent.answer or "").casefold()
        agent_pass = agent.outcome == "completed" and all(
            expected_term.casefold() in answer_text for expected_term in case.expected_terms
        )
        if retrieval_pass:
            retrieval_passes += 1
        if agent_pass:
            agent_passes += 1

        case_reports.append(
            {
                "case_id": case.case_id,
                "retrieval_pass": retrieval_pass,
                "agent_pass": agent_pass,
                "latency_ms": round(latency_ms, 3),
                "retrieval_paths": retrieval_paths,
                "agent_outcome": agent.outcome,
                "citations": [citation.model_dump() for citation in agent.citations],
            },
        )

    cases_total = len(cases)
    cases_passed = sum(
        1
        for report in case_reports
        if bool(report["retrieval_pass"]) and bool(report["agent_pass"])
    )
    summary = EvalSummary(
        cases_total=cases_total,
        cases_passed=cases_passed,
        retrieval_pass_rate=_ratio(retrieval_passes, cases_total),
        agent_pass_rate=_ratio(agent_passes, cases_total),
        latency_ms_p50=round(_percentile(latencies, 50), 3),
        latency_ms_p95=round(_percentile(latencies, 95), 3),
    )

    artifact_dir: str | None = None
    if request.record_artifacts:
        output_dir = settings.resolved_eval_artifact_dir / run_id
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "summary.json").write_text(
            json.dumps(summary.model_dump(), indent=2),
            encoding="utf-8",
        )
        (output_dir / "cases.json").write_text(
            json.dumps(case_reports, indent=2),
            encoding="utf-8",
        )
        artifact_dir = str(output_dir)

    return EvalRunResponse(
        run_id=run_id,
        dataset_id=request.dataset_id,
        summary=summary,
        artifact_dir=artifact_dir,
    )


def _load_dataset(dataset_dir: Path, dataset_id: str) -> list[EvalCase]:
    dataset_path = dataset_dir / f"{dataset_id}.json"
    if not dataset_path.exists():
        raise DatasetNotFoundError(f"Eval dataset not found: {dataset_path}")

    payload = json.loads(dataset_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise DatasetNotFoundError(f"Eval dataset must be a JSON array: {dataset_path}")
    return [EvalCase.model_validate(item) for item in payload]


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _coerce_int(value: object, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return value
    return int(str(value))


def _ratio(passed: int, total: int) -> float:
    if total == 0:
        return 0.0
    return round(passed / total, 3)


def _percentile(values: list[float], percentile: int) -> float:
    if not values:
        return 0.0
    if percentile <= 50:
        return float(median(values))
    ordered = sorted(values)
    index = round((len(ordered) - 1) * (percentile / 100))
    return float(ordered[index])
