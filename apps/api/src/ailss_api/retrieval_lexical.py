from __future__ import annotations

import sqlite3
from contextlib import closing
from time import perf_counter

from .config import Settings
from .models import EvidenceChunk, RetrievalUsage, RetrieveRequest, RetrieveResponse, RetrieveResult
from .retrieval_common import (
    LexicalNoteAccumulator,
    escape_like,
    excerpt_text,
    load_note_metadata,
    normalize_optional_text,
    parse_heading_path,
    read_note_preview,
    score_row,
    stitch_text_segments,
    tokenize_query,
)
from .retrieval_index import connect_db, ensure_index_ready, inspect_index, load_available_tables


def run_lexical_retrieval(
    request: RetrieveRequest,
    settings: Settings,
    started: float,
) -> RetrieveResponse:
    index_status = inspect_index(settings)
    ensure_index_ready(index_status)

    query_terms = tokenize_query(request.query)
    search_terms = query_terms or [request.query.casefold().strip()]
    warnings: list[str] = []
    if not query_terms:
        warnings.append(
            "Query terms were too short for token scoring; using whole-query lexical matching."
        )

    with closing(connect_db(index_status.db_path, load_vector_extension=False)) as conn:
        tables = load_available_tables(conn)
        rows = conn.execute(
            *build_lexical_candidate_query(request, search_terms, settings.max_candidates),
        ).fetchall()
        results = rank_lexical_rows(
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


def build_lexical_candidate_query(
    request: RetrieveRequest,
    search_terms: list[str],
    limit: int,
) -> tuple[str, list[object]]:
    where_clauses: list[str] = []
    params: list[object] = []

    term_clauses: list[str] = []
    for term in search_terms:
        like = f"%{escape_like(term)}%"
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
        params.append(f"{escape_like(request.path_prefix.strip())}%")
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


def rank_lexical_rows(
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
        title = normalize_optional_text(row["title"])
        summary = normalize_optional_text(row["summary"])
        heading = normalize_optional_text(row["heading"])
        content = str(row["content"])
        score = score_row(
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
            heading_path=parse_heading_path(row["heading_path_json"]),
            text=excerpt_text(content, search_terms),
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

    metadata = load_note_metadata(conn, list(notes), tables)
    ranked: list[RetrieveResult] = []
    for note in notes.values():
        top_evidence = sorted(
            note.evidence,
            key=lambda entry: entry.score or 0,
            reverse=True,
        )[: request.hit_chunks_per_note]
        preview = read_note_preview(
            settings, note.path, request.max_chars_per_note, request.include_file_preview
        )
        meta = metadata.get(note.path)
        stitched = stitch_text_segments(
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
