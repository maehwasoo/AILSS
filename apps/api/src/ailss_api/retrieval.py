from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Literal

import sqlite_vec  # type: ignore[import-untyped]

from .config import Settings
from .embeddings import embed_query
from .models import (
    EvidenceChunk,
    HealthChecks,
    HealthResponse,
    RetrievalUsage,
    RetrieveRequest,
    RetrieveResponse,
    RetrieveResult,
)

BASE_REQUIRED_TABLES = {"chunks", "db_meta", "note_tags", "notes"}
VECTOR_REQUIRED_TABLES = {"chunk_embeddings", "chunk_rowids"}
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{1,}")


class IndexNotReadyError(RuntimeError):
    """Index readiness failure."""


@dataclass(frozen=True)
class IndexStatus:
    db_path: Path | None
    db_configured: bool
    index_db_exists: bool
    index_schema_ready: bool
    vector_index_ready: bool
    available_tables: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class NoteMeta:
    title: str | None
    summary: str | None
    tags: list[str]
    keywords: list[str]


@dataclass(frozen=True)
class SemanticHit:
    chunk_id: str
    path: str
    chunk_index: int
    heading: str | None
    heading_path: list[str]
    content: str
    distance: float


@dataclass(frozen=True)
class SemanticSelection:
    path: str
    hits: list[SemanticHit]

    @property
    def best(self) -> SemanticHit:
        return self.hits[0]


@dataclass
class LexicalNoteAccumulator:
    path: str
    title: str | None
    summary: str | None
    score: float
    evidence: list[EvidenceChunk]


@dataclass(frozen=True)
class PreviewResult:
    text: str | None
    truncated: bool


@dataclass(frozen=True)
class StitchResult:
    text: str | None
    truncated: bool
    used_chunk_ids: list[str]


def build_health_response(settings: Settings) -> HealthResponse:
    index_status = inspect_index(settings)
    checks = HealthChecks(
        vault_configured=settings.resolved_vault_path is not None,
        db_configured=index_status.db_configured,
        index_db_exists=index_status.index_db_exists,
        index_schema_ready=index_status.index_schema_ready,
        vector_index_ready=index_status.vector_index_ready,
        openai_configured=bool((settings.openai_api_key or "").strip()),
        dataset_dir_exists=settings.resolved_dataset_dir.exists(),
        run_artifact_dir_parent_exists=settings.resolved_run_artifact_dir.parent.exists(),
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
            vector_index_ready=False,
        )

    if not db_path.exists():
        return IndexStatus(
            db_path=db_path,
            db_configured=True,
            index_db_exists=False,
            index_schema_ready=False,
            vector_index_ready=False,
        )

    try:
        with closing(sqlite3.connect(db_path)) as conn:
            tables = frozenset(
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
                ).fetchall()
            )
    except sqlite3.Error:
        return IndexStatus(
            db_path=db_path,
            db_configured=True,
            index_db_exists=True,
            index_schema_ready=False,
            vector_index_ready=False,
        )

    return IndexStatus(
        db_path=db_path,
        db_configured=True,
        index_db_exists=True,
        index_schema_ready=BASE_REQUIRED_TABLES.issubset(tables),
        vector_index_ready=BASE_REQUIRED_TABLES.issubset(tables)
        and VECTOR_REQUIRED_TABLES.issubset(tables),
        available_tables=tables,
    )


def retrieve_notes(request: RetrieveRequest, settings: Settings) -> RetrieveResponse:
    started = perf_counter()
    mode = request.mode
    if mode == "semantic":
        return _retrieve_semantic(request, settings, started)
    return _retrieve_lexical(request, settings, started)


def _retrieve_semantic(
    request: RetrieveRequest,
    settings: Settings,
    started: float,
) -> RetrieveResponse:
    index_status = inspect_index(settings)
    _ensure_index_ready(index_status)
    if not index_status.vector_index_ready:
        raise IndexNotReadyError(
            "Vector index is not ready. Reindex the vault so "
            "chunk_embeddings and chunk_rowids exist."
        )

    try:
        embedding = embed_query(settings, request.query)
    except ValueError as error:
        raise IndexNotReadyError(str(error)) from error
    with closing(_connect_db(index_status.db_path, load_vector_extension=True)) as conn:
        tables = _load_available_tables(conn)
        _ensure_embedding_config_matches(conn, settings, len(embedding.vector))
        used_chunks_k = min(
            settings.max_candidates,
            max(request.top_k * request.hit_chunks_per_note * 4, request.top_k),
        )
        rows = conn.execute(
            *_build_semantic_query(request, embedding.vector, used_chunks_k),
        ).fetchall()
        selections = _select_semantic_notes(rows, request.hit_chunks_per_note)[: request.top_k]
        metadata = _load_note_metadata(conn, [selection.path for selection in selections], tables)
        results = [
            _build_semantic_result(
                conn=conn,
                settings=settings,
                request=request,
                selection=selection,
                meta=metadata.get(selection.path),
            )
            for selection in selections
        ]

    usage = RetrievalUsage(
        latency_ms=round((perf_counter() - started) * 1000, 3),
        used_chunks_k=used_chunks_k,
        embedding_model=embedding.model,
        embedding_prompt_tokens=embedding.prompt_tokens,
    )
    return RetrieveResponse(
        query=request.query,
        mode="semantic_local",
        results=results,
        usage=usage,
    )


def _retrieve_lexical(
    request: RetrieveRequest,
    settings: Settings,
    started: float,
) -> RetrieveResponse:
    index_status = inspect_index(settings)
    _ensure_index_ready(index_status)

    query_terms = _tokenize_query(request.query)
    search_terms = query_terms or [request.query.casefold().strip()]
    warnings: list[str] = []
    if not query_terms:
        warnings.append(
            "Query terms were too short for token scoring; using whole-query lexical matching."
        )

    with closing(_connect_db(index_status.db_path, load_vector_extension=False)) as conn:
        tables = _load_available_tables(conn)
        rows = conn.execute(
            *_build_lexical_candidate_query(request, search_terms, settings.max_candidates),
        ).fetchall()
        results = _rank_lexical_rows(
            rows, request, query_terms, search_terms, settings, conn, tables
        )

    usage = RetrievalUsage(
        latency_ms=round((perf_counter() - started) * 1000, 3),
        used_chunks_k=min(settings.max_candidates, max(request.top_k * 2, request.top_k)),
    )
    return RetrieveResponse(
        query=request.query,
        mode="lexical_baseline",
        results=results[: request.top_k],
        warnings=warnings,
        usage=usage,
    )


def _ensure_index_ready(index_status: IndexStatus) -> None:
    if index_status.db_path is None:
        raise IndexNotReadyError(
            "Index DB is not configured. Set AILSS_DB_PATH or AILSS_VAULT_PATH."
        )
    if not index_status.index_db_exists:
        raise IndexNotReadyError(f"Index DB does not exist: {index_status.db_path}")
    if not index_status.index_schema_ready:
        raise IndexNotReadyError(f"Index DB schema is incomplete: {index_status.db_path}")


def _connect_db(db_path: Path | None, *, load_vector_extension: bool) -> sqlite3.Connection:
    if db_path is None:
        raise IndexNotReadyError("Index DB path is not configured.")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    if load_vector_extension:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
    return conn


def _load_available_tables(conn: sqlite3.Connection) -> frozenset[str]:
    return frozenset(
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
        ).fetchall()
    )


def _build_semantic_query(
    request: RetrieveRequest,
    query_embedding: list[float],
    used_chunks_k: int,
) -> tuple[str, list[object]]:
    candidate_where: list[str] = []
    candidate_params: list[object] = []

    if request.path_prefix:
        candidate_where.append("c.path LIKE ? ESCAPE '\\'")
        candidate_params.append(f"{_escape_like(request.path_prefix.strip())}%")

    if request.tags_any:
        placeholders = ", ".join("?" for _ in request.tags_any)
        candidate_where.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag IN "
            f"({placeholders}))"
        )
        candidate_params.extend(request.tags_any)

    for tag in request.tags_all:
        candidate_where.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag = ?)"
        )
        candidate_params.append(tag)

    has_scope = bool(candidate_where)
    candidates_cte = (
        """
        candidates AS (
          SELECT r.rowid AS rowid
          FROM chunks c
          JOIN chunk_rowids r ON r.chunk_id = c.chunk_id
          WHERE """
        + " AND ".join(candidate_where)
        + "\n        ),"
        if has_scope
        else ""
    )

    sql = f"""
        WITH {candidates_cte}
        matches AS (
          SELECT rowid, distance
          FROM chunk_embeddings
          WHERE embedding MATCH ?
            AND k = ?
            {"AND rowid IN (SELECT rowid FROM candidates)" if has_scope else ""}
          ORDER BY distance
        )
        SELECT
          c.chunk_id,
          c.path,
          c.chunk_index,
          c.heading,
          c.heading_path_json,
          c.content,
          m.distance
        FROM matches m
        JOIN chunk_rowids r ON r.rowid = m.rowid
        JOIN chunks c ON c.chunk_id = r.chunk_id
        ORDER BY m.distance
    """
    params: list[object] = []
    if has_scope:
        params.extend(candidate_params)
    params.extend([sqlite_vec.serialize_float32(query_embedding), used_chunks_k])
    return sql, params


def _select_semantic_notes(
    rows: list[sqlite3.Row], hit_chunks_per_note: int
) -> list[SemanticSelection]:
    grouped: dict[str, list[SemanticHit]] = {}
    for row in rows:
        path = str(row["path"])
        hits = grouped.setdefault(path, [])
        if len(hits) >= hit_chunks_per_note:
            continue
        hits.append(
            SemanticHit(
                chunk_id=str(row["chunk_id"]),
                path=path,
                chunk_index=int(row["chunk_index"]),
                heading=_normalize_optional_text(row["heading"]),
                heading_path=_parse_heading_path(row["heading_path_json"]),
                content=str(row["content"]),
                distance=round(float(row["distance"]), 6),
            )
        )

    ordered = [SemanticSelection(path=path, hits=hits) for path, hits in grouped.items()]
    ordered.sort(key=lambda selection: selection.best.distance)
    return ordered


def _build_semantic_result(
    conn: sqlite3.Connection,
    settings: Settings,
    request: RetrieveRequest,
    selection: SemanticSelection,
    meta: NoteMeta | None,
) -> RetrieveResult:
    wanted_indices = {
        selection.best.chunk_index + offset
        for offset in range(-request.neighbor_window, request.neighbor_window + 1)
    }
    wanted_indices.update(hit.chunk_index for hit in selection.hits[1:])
    chunks = _list_chunks_by_indices(
        conn, selection.path, sorted(index for index in wanted_indices if index >= 0)
    )
    hit_distances = {hit.chunk_id: hit.distance for hit in selection.hits}
    hit_chunk_ids = set(hit_distances)
    stitched = _stitch_chunks(chunks, request.max_evidence_chars_per_note)
    used_chunk_ids = set(stitched.used_chunk_ids)
    evidence = [
        EvidenceChunk(
            chunk_id=str(chunk["chunk_id"]),
            chunk_index=int(chunk["chunk_index"]),
            kind="hit" if str(chunk["chunk_id"]) in hit_chunk_ids else "neighbor",
            heading=_normalize_optional_text(chunk["heading"]),
            heading_path=_parse_heading_path(chunk["heading_path_json"]),
            text=_excerpt_text(str(chunk["content"]), _tokenize_query(request.query)),
            distance=hit_distances.get(str(chunk["chunk_id"])),
        )
        for chunk in chunks
        if str(chunk["chunk_id"]) in used_chunk_ids
    ]
    preview = _read_note_preview(
        settings, selection.path, request.max_chars_per_note, request.include_file_preview
    )
    summary = meta.summary if meta else None
    snippet_source = stitched.text or selection.best.content
    return RetrieveResult(
        path=selection.path,
        title=meta.title if meta else None,
        summary=summary,
        tags=meta.tags if meta else [],
        keywords=meta.keywords if meta else [],
        distance=selection.best.distance,
        heading=selection.best.heading,
        heading_path=selection.best.heading_path,
        snippet=snippet_source[:300],
        evidence_text=stitched.text,
        evidence_truncated=stitched.truncated,
        preview=preview.text,
        preview_truncated=preview.truncated,
        evidence=evidence,
    )


def _build_lexical_candidate_query(
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
            f"({placeholders}))"
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
          c.heading_path_json,
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


def _rank_lexical_rows(
    rows: list[sqlite3.Row],
    request: RetrieveRequest,
    query_terms: list[str],
    search_terms: list[str],
    settings: Settings,
    conn: sqlite3.Connection,
    tables: frozenset[str],
) -> list[RetrieveResult]:
    notes: dict[str, LexicalNoteAccumulator] = {}
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
            chunk_index=int(row["chunk_index"]),
            kind="match",
            heading=heading,
            heading_path=_parse_heading_path(row["heading_path_json"]),
            text=_excerpt_text(content, search_terms),
            score=round(score, 3),
        )
        note_entry = notes.setdefault(
            path,
            LexicalNoteAccumulator(
                path=path,
                title=title,
                summary=summary,
                score=score,
                evidence=[],
            ),
        )
        note_entry.score = max(note_entry.score, score)
        note_entry.evidence.append(evidence)

    if not notes:
        return []

    metadata = _load_note_metadata(conn, list(notes), tables)
    ranked: list[RetrieveResult] = []
    for note in notes.values():
        top_evidence = sorted(
            note.evidence,
            key=lambda entry: entry.score or 0,
            reverse=True,
        )[: request.hit_chunks_per_note]
        preview = _read_note_preview(
            settings, note.path, request.max_chars_per_note, request.include_file_preview
        )
        meta = metadata.get(note.path)
        stitched = _stitch_text_segments(
            [chunk.text for chunk in top_evidence],
            request.max_evidence_chars_per_note,
        )
        top_chunk = top_evidence[0]
        score = round(note.score + max(0, len(top_evidence) - 1) * 0.25, 3)
        ranked.append(
            RetrieveResult(
                path=note.path,
                title=meta.title if meta else note.title,
                summary=meta.summary if meta else note.summary,
                tags=meta.tags if meta else [],
                keywords=meta.keywords if meta else [],
                score=score,
                heading=top_chunk.heading,
                heading_path=top_chunk.heading_path,
                snippet=top_chunk.text[:300],
                evidence_text=stitched.text,
                evidence_truncated=stitched.truncated,
                preview=preview.text,
                preview_truncated=preview.truncated,
                evidence=top_evidence,
            )
        )

    ranked.sort(key=lambda result: result.score or 0, reverse=True)
    return ranked


def _load_note_metadata(
    conn: sqlite3.Connection,
    paths: list[str],
    tables: frozenset[str],
) -> dict[str, NoteMeta]:
    if not paths:
        return {}

    placeholders = ", ".join("?" for _ in paths)
    notes_rows = conn.execute(
        f"SELECT path, title, summary FROM notes WHERE path IN ({placeholders})",
        paths,
    ).fetchall()
    metadata: dict[str, NoteMeta] = {
        str(row["path"]): NoteMeta(
            title=_normalize_optional_text(row["title"]),
            summary=_normalize_optional_text(row["summary"]),
            tags=[],
            keywords=[],
        )
        for row in notes_rows
    }

    if "note_tags" in tables:
        for row in conn.execute(
            f"SELECT path, tag FROM note_tags WHERE path IN ({placeholders}) ORDER BY tag",
            paths,
        ).fetchall():
            path = str(row["path"])
            existing = metadata.get(path, NoteMeta(title=None, summary=None, tags=[], keywords=[]))
            metadata[path] = NoteMeta(
                title=existing.title,
                summary=existing.summary,
                tags=[*existing.tags, str(row["tag"])],
                keywords=existing.keywords,
            )

    if "note_keywords" in tables:
        for row in conn.execute(
            "SELECT path, keyword FROM note_keywords "
            f"WHERE path IN ({placeholders}) ORDER BY keyword",
            paths,
        ).fetchall():
            path = str(row["path"])
            existing = metadata.get(path, NoteMeta(title=None, summary=None, tags=[], keywords=[]))
            metadata[path] = NoteMeta(
                title=existing.title,
                summary=existing.summary,
                tags=existing.tags,
                keywords=[*existing.keywords, str(row["keyword"])],
            )

    return metadata


def _list_chunks_by_indices(
    conn: sqlite3.Connection,
    path: str,
    indices: list[int],
) -> list[sqlite3.Row]:
    if not indices:
        return []
    placeholders = ", ".join("?" for _ in indices)
    return conn.execute(
        f"""
        SELECT chunk_id, chunk_index, heading, heading_path_json, content
        FROM chunks
        WHERE path = ? AND chunk_index IN ({placeholders})
        ORDER BY chunk_index
        """,
        [path, *indices],
    ).fetchall()


def _stitch_chunks(chunks: list[sqlite3.Row], max_chars: int) -> StitchResult:
    budget = max(1, min(max_chars, 20_000))
    text = ""
    truncated = False
    used_chunk_ids: list[str] = []
    for chunk in chunks:
        part = str(chunk["content"]).strip()
        if not part:
            continue
        separator = "\n\n" if text else ""
        next_text = f"{text}{separator}{part}"
        if len(next_text) <= budget:
            text = next_text
            used_chunk_ids.append(str(chunk["chunk_id"]))
            continue

        remaining = budget - len(text) - len(separator)
        if remaining > 0:
            text = f"{text}{separator}{part[:remaining]}"
            used_chunk_ids.append(str(chunk["chunk_id"]))
        truncated = True
        break

    return StitchResult(
        text=text or None,
        truncated=truncated,
        used_chunk_ids=used_chunk_ids,
    )


def _stitch_text_segments(segments: list[str], max_chars: int) -> StitchResult:
    budget = max(1, min(max_chars, 20_000))
    text = ""
    truncated = False
    used_segment_ids: list[str] = []
    for index, segment in enumerate(segments):
        part = segment.strip()
        if not part:
            continue
        separator = "\n\n" if text else ""
        next_text = f"{text}{separator}{part}"
        if len(next_text) <= budget:
            text = next_text
            used_segment_ids.append(str(index))
            continue
        remaining = budget - len(text) - len(separator)
        if remaining > 0:
            text = f"{text}{separator}{part[:remaining]}"
            used_segment_ids.append(str(index))
        truncated = True
        break

    return StitchResult(text=text or None, truncated=truncated, used_chunk_ids=used_segment_ids)


def _read_note_preview(
    settings: Settings,
    note_path: str,
    max_chars: int,
    include_preview: bool,
) -> PreviewResult:
    if not include_preview:
        return PreviewResult(text=None, truncated=False)

    vault_path = settings.resolved_vault_path
    if vault_path is None:
        return PreviewResult(text=None, truncated=False)

    candidate = vault_path / Path(note_path)
    if not candidate.exists():
        return PreviewResult(text=None, truncated=False)

    text = candidate.read_text(encoding="utf-8")
    if len(text) <= max_chars:
        return PreviewResult(text=text.strip() or None, truncated=False)
    return PreviewResult(text=text[:max_chars].strip() or None, truncated=True)


def _ensure_embedding_config_matches(
    conn: sqlite3.Connection,
    settings: Settings,
    embedding_dim: int,
) -> None:
    meta = {
        str(row["key"]): str(row["value"])
        for row in conn.execute(
            "SELECT key, value FROM db_meta WHERE key IN ('embedding_model', 'embedding_dim')"
        ).fetchall()
    }
    expected_model = meta.get("embedding_model")
    if expected_model and expected_model != settings.openai_embedding_model:
        raise IndexNotReadyError(
            "Embedding model mismatch between the local DB and Python backend settings. "
            "DB expects "
            f"{expected_model}, backend is configured for "
            f"{settings.openai_embedding_model}."
        )

    expected_dim = meta.get("embedding_dim")
    if expected_dim and int(expected_dim) != embedding_dim:
        raise IndexNotReadyError(
            "Embedding dimension mismatch between the local DB and Python backend settings. "
            f"DB expects {expected_dim}, query embedding was {embedding_dim}."
        )


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
    haystacks = {
        "path": path.casefold(),
        "title": (title or "").casefold(),
        "summary": (summary or "").casefold(),
        "heading": (heading or "").casefold(),
        "content": content.casefold(),
    }

    score = 0.0
    for term in query_terms:
        score += haystacks["title"].count(term) * 2.0
        score += haystacks["summary"].count(term) * 1.6
        score += haystacks["heading"].count(term) * 1.3
        score += haystacks["content"].count(term) * 1.0
        score += haystacks["path"].count(term) * 0.5

    if query_text:
        if query_text in haystacks["title"]:
            score += 3.0
        if query_text in haystacks["summary"]:
            score += 2.5
        if query_text in haystacks["content"]:
            score += 1.5

    coverage = sum(1 for term in search_terms if term and term in haystacks["content"])
    score += coverage * 0.75
    return score


def _excerpt_text(content: str, search_terms: list[str]) -> str:
    normalized = content.strip()
    if not normalized:
        return ""
    lowered = normalized.casefold()
    for term in search_terms:
        if not term:
            continue
        index = lowered.find(term.casefold())
        if index < 0:
            continue
        start = max(0, index - 80)
        end = min(len(normalized), index + len(term) + 160)
        excerpt = normalized[start:end].strip()
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(normalized) else ""
        return f"{prefix}{excerpt}{suffix}"
    return normalized[:240] + ("..." if len(normalized) > 240 else "")


def _tokenize_query(query: str) -> list[str]:
    return [token.casefold() for token in TOKEN_PATTERN.findall(query.casefold())]


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_heading_path(value: object) -> list[str]:
    if value is None:
        return []
    raw = str(value).strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed]
