from __future__ import annotations

import json
from json import JSONDecodeError
from pathlib import Path
from statistics import median
from time import perf_counter
from uuid import uuid4

from pydantic import BaseModel, Field, ValidationError, field_validator

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


class InvalidEvalDatasetError(RuntimeError):
    """Dataset content validation failure."""


class EvalCase(BaseModel):
    case_id: str
    input: str = Field(min_length=1)
    context: dict[str, object] = Field(default_factory=dict)
    expected_paths: list[str] = Field(default_factory=list)
    expected_terms: list[str] = Field(default_factory=list)

    @field_validator("input", mode="before")
    @classmethod
    def strip_input(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value


def run_eval(request: EvalRunRequest, settings: Settings) -> EvalRunResponse:
    cases = _load_dataset(settings.resolved_dataset_dir, request.dataset_id)[: request.limit]
    run_id = f"eval_{uuid4().hex[:12]}"
    latencies: list[float] = []
    retrieval_passes = 0
    agent_passes = 0
    embedding_prompt_tokens_total = 0
    failure_counts: dict[str, int] = {}
    case_reports: list[dict[str, object]] = []

    for case in cases:
        started = perf_counter()
        top_k = _coerce_eval_top_k(
            case.context.get("top_k"),
            settings.default_top_k,
            case.case_id,
        )
        agent_top_k = _clamp_agent_top_k(top_k)
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
                    top_k=agent_top_k,
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
        if agent.metrics.embedding_prompt_tokens is not None:
            embedding_prompt_tokens_total += agent.metrics.embedding_prompt_tokens
        if agent.failure is not None:
            failure_counts[agent.failure.code] = failure_counts.get(agent.failure.code, 0) + 1

        case_reports.append(
            {
                "case_id": case.case_id,
                "retrieval_pass": retrieval_pass,
                "agent_pass": agent_pass,
                "latency_ms": round(latency_ms, 3),
                "retrieval_paths": retrieval_paths,
                "agent_outcome": agent.outcome,
                "agent_failure": agent.failure.model_dump() if agent.failure else None,
                "citations": [citation.model_dump() for citation in agent.citations],
                "metrics": agent.metrics.model_dump(),
                "artifact_path": agent.artifact_path,
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
        embedding_prompt_tokens_total=embedding_prompt_tokens_total or None,
        failure_counts=failure_counts,
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
    dataset_path = _resolve_dataset_path(dataset_dir, dataset_id)
    if not dataset_path.is_file():
        raise DatasetNotFoundError(f"Eval dataset not found: {dataset_path}")

    try:
        payload = json.loads(dataset_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as error:
        raise InvalidEvalDatasetError(
            f"Eval dataset could not be read as UTF-8 text: {dataset_path}"
        ) from error
    except JSONDecodeError as error:
        raise InvalidEvalDatasetError(f"Eval dataset is not valid JSON: {dataset_path}") from error

    if not isinstance(payload, list):
        raise InvalidEvalDatasetError(f"Eval dataset must be a JSON array: {dataset_path}")

    cases: list[EvalCase] = []
    for index, item in enumerate(payload):
        try:
            cases.append(EvalCase.model_validate(item))
        except ValidationError as error:
            raise InvalidEvalDatasetError(
                f"Eval dataset entry {index} failed validation: {_format_validation_error(error)}"
            ) from error
    return cases


def _resolve_dataset_path(dataset_dir: Path, dataset_id: str) -> Path:
    dataset_root = dataset_dir.resolve()
    candidate = (dataset_root / Path(f"{dataset_id}.json")).resolve()
    try:
        candidate.relative_to(dataset_root)
    except ValueError as error:
        raise InvalidEvalDatasetError(
            "Eval dataset_id must stay within the configured dataset_dir."
        ) from error
    return candidate


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


def _coerce_eval_top_k(value: object, default: int, case_id: str) -> int:
    try:
        candidate = _coerce_int(value, default)
    except (TypeError, ValueError) as error:
        raise InvalidEvalDatasetError(
            f"Eval dataset case {case_id} has a non-integer context.top_k."
        ) from error

    if candidate < 1 or candidate > 20:
        raise InvalidEvalDatasetError(
            f"Eval dataset case {case_id} has invalid context.top_k={candidate}. Expected 1..20."
        )
    return candidate


def _clamp_agent_top_k(value: int) -> int:
    return min(value, 10)


def _format_validation_error(error: ValidationError) -> str:
    issue = error.errors()[0]
    location = ".".join(str(part) for part in issue["loc"])
    return f"{location}: {issue['msg']}"


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
