from __future__ import annotations

import sqlite3
from collections.abc import Callable
from contextlib import closing
from time import perf_counter

import sqlite_vec  # type: ignore[import-untyped]

from .config import Settings
from .embeddings import EmbedQueryResult
from .models import EvidenceChunk, RetrievalUsage, RetrieveRequest, RetrieveResponse, RetrieveResult
from .retrieval_common import (
    NoteMeta,
    SemanticHit,
    SemanticSelection,
    escape_like,
    excerpt_text,
    list_chunks_by_indices,
    load_note_metadata,
    normalize_optional_text,
    parse_heading_path,
    read_note_preview,
    stitch_chunks,
    tokenize_query,
)
from .retrieval_index import (
    IndexNotReadyError,
    connect_db,
    ensure_embedding_config_matches,
    ensure_index_ready,
    inspect_index,
    load_available_tables,
)


def run_semantic_retrieval(
    request: RetrieveRequest,
    settings: Settings,
    started: float,
    *,
    embed_query_fn: Callable[[Settings, str], EmbedQueryResult],
) -> RetrieveResponse:
    index_status = inspect_index(settings)
    ensure_index_ready(index_status)
    if not index_status.vector_index_ready:
        raise IndexNotReadyError(
            "Vector index is not ready. Reindex the vault so "
            "chunk_embeddings and chunk_rowids exist."
        )

    try:
        embedding = embed_query_fn(settings, request.query)
    except ValueError as error:
        raise IndexNotReadyError(str(error)) from error

    with closing(connect_db(index_status.db_path, load_vector_extension=True)) as conn:
        tables = load_available_tables(conn)
        ensure_embedding_config_matches(conn, settings, len(embedding.vector))
        used_chunks_k = min(
            settings.max_candidates,
            max(request.top_k * request.hit_chunks_per_note * 4, request.top_k),
        )
        rows = conn.execute(
            *build_semantic_query(request, embedding.vector, used_chunks_k),
        ).fetchall()
        selections = select_semantic_notes(rows, request.hit_chunks_per_note)[: request.top_k]
        metadata = load_note_metadata(conn, [selection.path for selection in selections], tables)
        results = [
            build_semantic_result(
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


def build_semantic_query(
    request: RetrieveRequest,
    query_embedding: list[float],
    used_chunks_k: int,
) -> tuple[str, list[object]]:
    candidate_where: list[str] = []
    candidate_params: list[object] = []

    if request.path_prefix:
        candidate_where.append("c.path LIKE ? ESCAPE '\\'")
        candidate_params.append(f"{escape_like(request.path_prefix.strip())}%")

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


def select_semantic_notes(
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
                heading=normalize_optional_text(row["heading"]),
                heading_path=parse_heading_path(row["heading_path_json"]),
                content=str(row["content"]),
                distance=round(float(row["distance"]), 6),
            )
        )

    ordered = [SemanticSelection(path=path, hits=hits) for path, hits in grouped.items()]
    ordered.sort(key=lambda selection: selection.best.distance)
    return ordered


def build_semantic_result(
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
    chunks = list_chunks_by_indices(
        conn, selection.path, sorted(index for index in wanted_indices if index >= 0)
    )
    hit_distances = {hit.chunk_id: hit.distance for hit in selection.hits}
    hit_chunk_ids = set(hit_distances)
    stitched = stitch_chunks(chunks, request.max_evidence_chars_per_note)
    used_chunk_ids = set(stitched.used_chunk_ids)
    evidence = [
        EvidenceChunk(
            chunk_id=str(chunk["chunk_id"]),
            chunk_index=int(chunk["chunk_index"]),
            kind="hit" if str(chunk["chunk_id"]) in hit_chunk_ids else "neighbor",
            heading=normalize_optional_text(chunk["heading"]),
            heading_path=parse_heading_path(chunk["heading_path_json"]),
            text=excerpt_text(str(chunk["content"]), tokenize_query(request.query)),
            distance=hit_distances.get(str(chunk["chunk_id"])),
        )
        for chunk in chunks
        if str(chunk["chunk_id"]) in used_chunk_ids
    ]
    preview = read_note_preview(
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
