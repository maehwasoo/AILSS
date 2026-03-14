from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FailureCode = Literal[
    "missing_context",
    "ambiguous_note_resolution",
    "grounding_failure",
    "write_not_allowed",
    "apply_not_requested",
]


class HealthChecks(BaseModel):
    vault_configured: bool
    db_configured: bool
    index_db_exists: bool
    index_schema_ready: bool
    dataset_dir_exists: bool


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    checks: HealthChecks


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    path_prefix: str | None = None
    tags_any: list[str] = Field(default_factory=list)
    tags_all: list[str] = Field(default_factory=list)


class EvidenceChunk(BaseModel):
    chunk_id: str
    heading: str | None = None
    text: str
    score: float


class RetrieveResult(BaseModel):
    path: str
    title: str | None = None
    summary: str | None = None
    score: float
    evidence: list[EvidenceChunk]


class RetrieveResponse(BaseModel):
    status: Literal["ok"] = "ok"
    query: str
    mode: Literal["lexical_baseline"] = "lexical_baseline"
    results: list[RetrieveResult]
    warnings: list[str] = Field(default_factory=list)


class AgentRunContext(BaseModel):
    path_prefix: str | None = None
    tags_any: list[str] = Field(default_factory=list)
    tags_all: list[str] = Field(default_factory=list)
    top_k: int = Field(default=3, ge=1, le=10)


class Citation(BaseModel):
    path: str
    chunk_id: str


class WorkflowStep(BaseModel):
    name: str
    outcome: Literal["completed", "failed", "skipped"]
    detail: str | None = None


class AgentFailure(BaseModel):
    code: FailureCode
    message: str


class WriteAction(BaseModel):
    action: str
    allowed: bool
    reason: str


class AgentRunRequest(BaseModel):
    input: str = Field(min_length=1)
    session_id: str | None = None
    apply: bool = False
    requested_write_action: str | None = None
    context: AgentRunContext = Field(default_factory=AgentRunContext)


class AgentRunResponse(BaseModel):
    status: Literal["ok"] = "ok"
    run_id: str
    outcome: Literal["completed", "failed"]
    answer: str | None = None
    citations: list[Citation] = Field(default_factory=list)
    workflow: list[WorkflowStep] = Field(default_factory=list)
    failure: AgentFailure | None = None
    write_actions: list[WriteAction] = Field(default_factory=list)


class EvalRunRequest(BaseModel):
    dataset_id: str = "golden-local-baseline"
    limit: int = Field(default=25, ge=1, le=200)
    record_artifacts: bool = True


class EvalSummary(BaseModel):
    cases_total: int
    cases_passed: int
    retrieval_pass_rate: float
    agent_pass_rate: float
    latency_ms_p50: float
    latency_ms_p95: float


class EvalRunResponse(BaseModel):
    status: Literal["ok"] = "ok"
    run_id: str
    dataset_id: str
    summary: EvalSummary
    artifact_dir: str | None = None
    warnings: list[str] = Field(default_factory=list)
