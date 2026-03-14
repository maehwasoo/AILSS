from __future__ import annotations

import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .config import Settings
from .models import (
    EvidenceChunk,
    HealthChecks,
    HealthResponse,
    RetrieveRequest,
    RetrieveResponse,
    RetrieveResult,
)

REQUIRED_TABLES = {"chunks", "db_meta", "note_tags", "notes"}
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{1,}")


class IndexNotReadyError(RuntimeError):
    """Index readiness failure."""


@dataclass(frozen=True)
class IndexStatus:
    db_path: Path | None
    db_configured: bool
    index_db_exists: bool
    index_schema_ready: bool


@dataclass
class NoteAccumulator:
    path: str
    title: str | None
    summary: str | None
    score: float
    evidence: list[EvidenceChunk]


def build_health_response(settings: Settings) -> HealthResponse:
    index_status = inspect_index(settings)
    checks = HealthChecks(
        vault_configured=settings.resolved_vault_path is not None,
        db_configured=index_status.db_configured,
        index_db_exists=index_status.index_db_exists,
        index_schema_ready=index_status.index_schema_ready,
        dataset_dir_exists=settings.resolved_dataset_dir.exists(),
    )
    status: Literal["ok", "degraded"] = "ok" if all(checks.model_dump().values()) else "degraded"
    return HealthResponse(
        status=status,
        service="ailss-api",
        version="0.1.0-dev",
        checks=checks,
    )


def inspect_index(settings: Settings) -> IndexStatus:
    db_path = settings.resolved_db_path
    if db_path is None:
        return IndexStatus(
            db_path=None,
            db_configured=False,
            index_db_exists=False,
            index_schema_ready=False,
        )

    if not db_path.exists():
        return IndexStatus(
            db_path=db_path,
            db_configured=True,
            index_db_exists=False,
            index_schema_ready=False,
        )

    try:
        with closing(sqlite3.connect(db_path)) as conn:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'",
                ).fetchall()
            }
    except sqlite3.Error:
        return IndexStatus(
            db_path=db_path,
            db_configured=True,
            index_db_exists=True,
            index_schema_ready=False,
        )

    return IndexStatus(
        db_path=db_path,
        db_configured=True,
        index_db_exists=True,
        index_schema_ready=REQUIRED_TABLES.issubset(tables),
    )


def retrieve_notes(request: RetrieveRequest, settings: Settings) -> RetrieveResponse:
    index_status = inspect_index(settings)
    if index_status.db_path is None:
        raise IndexNotReadyError(
            "Index DB is not configured. Set AILSS_DB_PATH or AILSS_VAULT_PATH."
        )
    if not index_status.index_db_exists:
        raise IndexNotReadyError(f"Index DB does not exist: {index_status.db_path}")
    if not index_status.index_schema_ready:
        raise IndexNotReadyError(f"Index DB schema is incomplete: {index_status.db_path}")

    query_terms = _tokenize_query(request.query)
    search_terms = query_terms or [request.query.casefold().strip()]
    warnings: list[str] = []
    if not query_terms:
        warnings.append(
            "Query terms were too short for token scoring; using whole-query lexical matching."
        )

    with closing(sqlite3.connect(index_status.db_path)) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            *_build_candidate_query(request, search_terms, settings.max_candidates),
        ).fetchall()

    results = _rank_rows(rows, request, query_terms, search_terms)
    return RetrieveResponse(
        query=request.query,
        results=results[: request.top_k],
        warnings=warnings,
    )


def _build_candidate_query(
    request: RetrieveRequest,
    search_terms: list[str],
    limit: int,
) -> tuple[str, list[object]]:
    where_clauses: list[str] = []
    params: list[object] = []

    term_clauses: list[str] = []
    for term in search_terms:
        like = f"%{_escape_like(term)}%"
        term_clauses.append(
            "("
            "LOWER(COALESCE(n.title, '')) LIKE ? ESCAPE '\\' OR "
            "LOWER(COALESCE(n.summary, '')) LIKE ? ESCAPE '\\' OR "
            "LOWER(c.content) LIKE ? ESCAPE '\\'"
            ")",
        )
        params.extend([like, like, like])
    where_clauses.append(f"({' OR '.join(term_clauses)})")

    if request.path_prefix:
        params.append(f"{_escape_like(request.path_prefix.strip())}%")
        where_clauses.append("c.path LIKE ? ESCAPE '\\'")

    if request.tags_any:
        placeholders = ", ".join("?" for _ in request.tags_any)
        where_clauses.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag IN "
            f"({placeholders}))",
        )
        params.extend(request.tags_any)

    for tag in request.tags_all:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag = ?)"
        )
        params.append(tag)

    sql = f"""
        SELECT
          c.chunk_id,
          c.path,
          c.chunk_index,
          c.heading,
          c.content,
          n.title,
          n.summary
        FROM chunks c
        LEFT JOIN notes n ON n.path = c.path
        WHERE {" AND ".join(where_clauses)}
        ORDER BY c.path, c.chunk_index
        LIMIT ?
    """
    params.append(limit)
    return sql, params


def _rank_rows(
    rows: list[sqlite3.Row],
    request: RetrieveRequest,
    query_terms: list[str],
    search_terms: list[str],
) -> list[RetrieveResult]:
    notes: dict[str, NoteAccumulator] = {}
    query_text = request.query.casefold().strip()

    for row in rows:
        path = str(row["path"])
        title = _normalize_optional_text(row["title"])
        summary = _normalize_optional_text(row["summary"])
        heading = _normalize_optional_text(row["heading"])
        content = str(row["content"])
        score = _score_row(
            query_text=query_text,
            query_terms=query_terms,
            search_terms=search_terms,
            path=path,
            title=title,
            summary=summary,
            heading=heading,
            content=content,
        )
        if score <= 0:
            continue

        evidence = EvidenceChunk(
            chunk_id=str(row["chunk_id"]),
            heading=heading,
            text=_excerpt_text(content, search_terms),
            score=round(score, 3),
        )
        note_entry = notes.setdefault(
            path,
            NoteAccumulator(
                path=path,
                title=title,
                summary=summary,
                score=score,
                evidence=[],
            ),
        )
        note_entry.score = max(note_entry.score, score)
        note_entry.evidence.append(evidence)

    ranked: list[RetrieveResult] = []
    for note in notes.values():
        top_evidence = sorted(
            note.evidence,
            key=lambda entry: entry.score,
            reverse=True,
        )[:2]
        score = round(note.score + max(0, len(top_evidence) - 1) * 0.25, 3)
        ranked.append(
            RetrieveResult(
                path=note.path,
                title=note.title,
                summary=note.summary,
                score=score,
                evidence=top_evidence,
            ),
        )

    ranked.sort(key=lambda result: (-result.score, result.path))
    return ranked


def _score_row(
    *,
    query_text: str,
    query_terms: list[str],
    search_terms: list[str],
    path: str,
    title: str | None,
    summary: str | None,
    heading: str | None,
    content: str,
) -> float:
    title_text = (title or "").casefold()
    summary_text = (summary or "").casefold()
    heading_text = (heading or "").casefold()
    path_text = path.casefold()
    content_text = content.casefold()

    score = 0.0
    if query_text and query_text in title_text:
        score += 7.0
    if query_text and query_text in summary_text:
        score += 4.0
    if query_text and query_text in path_text:
        score += 3.0
    if query_text and query_text in heading_text:
        score += 2.0
    if query_text and query_text in content_text:
        score += 1.5

    for term in query_terms or search_terms:
        if term in title_text:
            score += 3.0
        if term in summary_text:
            score += 2.0
        if term in path_text:
            score += 1.0
        if term in heading_text:
            score += 1.0
        score += min(content_text.count(term), 3) * 0.5

    return score


def _excerpt_text(content: str, search_terms: list[str], max_chars: int = 220) -> str:
    lowered = content.casefold()
    for term in search_terms:
        index = lowered.find(term)
        if index >= 0:
            start = max(0, index - 60)
            end = min(len(content), index + max_chars - 60)
            excerpt = content[start:end].strip()
            if start > 0:
                excerpt = f"...{excerpt}"
            if end < len(content):
                excerpt = f"{excerpt}..."
            return excerpt
    excerpt = content[:max_chars].strip()
    if len(content) > max_chars:
        return f"{excerpt}..."
    return excerpt


def _tokenize_query(query: str) -> list[str]:
    seen: list[str] = []
    for match in TOKEN_PATTERN.findall(query.casefold()):
        if match not in seen:
            seen.append(match)
    return seen


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
