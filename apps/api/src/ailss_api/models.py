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

RetrieveMode = Literal["semantic", "lexical"]
RetrieveResponseMode = Literal["semantic_local", "lexical_baseline"]


class HealthChecks(BaseModel):
    vault_configured: bool
    db_configured: bool
    index_db_exists: bool
    index_schema_ready: bool
    vector_index_ready: bool
    openai_configured: bool
    dataset_dir_exists: bool
    run_artifact_dir_parent_exists: bool


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    checks: HealthChecks


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    mode: RetrieveMode = "semantic"
    top_k: int = Field(default=5, ge=1, le=20)
    path_prefix: str | None = None
    tags_any: list[str] = Field(default_factory=list)
    tags_all: list[str] = Field(default_factory=list)
    hit_chunks_per_note: int = Field(default=2, ge=1, le=5)
    neighbor_window: int = Field(default=1, ge=0, le=3)
    include_file_preview: bool = False
    max_evidence_chars_per_note: int = Field(default=1500, ge=200, le=20_000)
    max_chars_per_note: int = Field(default=800, ge=200, le=50_000)


class EvidenceChunk(BaseModel):
    chunk_id: str
    chunk_index: int | None = None
    kind: Literal["hit", "neighbor", "match"] = "match"
    heading: str | None = None
    heading_path: list[str] = Field(default_factory=list)
    text: str
    score: float | None = None
    distance: float | None = None


class RetrieveResult(BaseModel):
    path: str
    title: str | None = None
    summary: str | None = None
    tags: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    score: float | None = None
    distance: float | None = None
    heading: str | None = None
    heading_path: list[str] = Field(default_factory=list)
    snippet: str
    evidence_text: str | None = None
    evidence_truncated: bool = False
    preview: str | None = None
    preview_truncated: bool = False
    evidence: list[EvidenceChunk]


class RetrievalUsage(BaseModel):
    latency_ms: float
    used_chunks_k: int
    embedding_model: str | None = None
    embedding_prompt_tokens: int | None = None


class RetrieveResponse(BaseModel):
    status: Literal["ok"] = "ok"
    query: str
    mode: RetrieveResponseMode
    results: list[RetrieveResult]
    warnings: list[str] = Field(default_factory=list)
    usage: RetrievalUsage


class AgentRunContext(BaseModel):
    retrieval_mode: RetrieveMode = "semantic"
    path_prefix: str | None = None
    tags_any: list[str] = Field(default_factory=list)
    tags_all: list[str] = Field(default_factory=list)
    top_k: int = Field(default=3, ge=1, le=10)
    hit_chunks_per_note: int = Field(default=2, ge=1, le=5)
    neighbor_window: int = Field(default=1, ge=0, le=3)


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


class AgentRunMetrics(BaseModel):
    latency_ms: float
    retrieval_latency_ms: float
    retrieval_mode: RetrieveResponseMode
    selected_notes: int
    embedding_prompt_tokens: int | None = None


class AgentRunResponse(BaseModel):
    status: Literal["ok"] = "ok"
    run_id: str
    outcome: Literal["completed", "failed"]
    answer: str | None = None
    citations: list[Citation] = Field(default_factory=list)
    workflow: list[WorkflowStep] = Field(default_factory=list)
    failure: AgentFailure | None = None
    write_actions: list[WriteAction] = Field(default_factory=list)
    metrics: AgentRunMetrics
    artifact_path: str | None = None


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
    embedding_prompt_tokens_total: int | None = None
    failure_counts: dict[str, int] = Field(default_factory=dict)


class EvalRunResponse(BaseModel):
    status: Literal["ok"] = "ok"
    run_id: str
    dataset_id: str
    summary: EvalSummary
    artifact_dir: str | None = None
    warnings: list[str] = Field(default_factory=list)
