from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path

from openai import OpenAI

from .index_db import (
    delete_chunks_by_ids,
    delete_file_by_path,
    get_file_sha256,
    insert_chunk_with_embedding,
    list_chunk_embeddings_by_path,
    list_chunk_ids_by_path,
    list_file_paths,
    replace_note_keywords,
    replace_note_sources,
    replace_note_tags,
    replace_typed_links,
    update_chunk_metadata,
    upsert_file,
    upsert_note,
)
from .vault_runtime import (
    MarkdownChunk,
    VaultMarkdownFile,
    chunk_markdown_by_headings,
    is_default_ignored_vault_rel_path,
    list_markdown_files,
    normalize_ailss_note_meta,
    normalize_vault_rel_path,
    parse_markdown_note,
    read_utf8_file,
    stat_markdown_file,
)


@dataclass(frozen=True)
class IndexVaultSummary:
    changed_files: int
    indexed_chunks: int
    deleted_files: int


@dataclass(frozen=True)
class EmbeddingInputMeta:
    title: str
    summary: str


@dataclass(frozen=True)
class PlannedChunk:
    chunk_id: str
    content: str
    content_sha256: str
    embedding_input: str
    embedding_input_sha256: str
    chunk_index: int
    heading: str | None
    heading_path_json: str


@dataclass
class ChunkDiffPlan:
    planned_chunks: list[PlannedChunk]
    existing_chunk_ids_after_delete: set[str]
    to_delete: list[str]
    embedding_by_input_sha: dict[str, list[float]] = field(default_factory=dict)
    to_embed: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class IndexVaultOptions:
    conn: sqlite3.Connection
    db_path_for_log: str
    vault_path: Path
    openai: OpenAI
    embedding_model: str
    max_chars: int = 4000
    batch_size: int = 32
    paths: list[str] | None = None
    logger_log: Callable[[str], None] | None = None
    logger_write: Callable[[str], None] | None = None


def _sha256_text(input_text: str) -> str:
    return sha256(input_text.encode("utf-8")).hexdigest()


def build_chunk_embedding_input(
    meta: EmbeddingInputMeta,
    chunk: MarkdownChunk,
) -> str:
    heading_path = " > ".join(chunk.heading_path)
    return "\n".join(
        [
            f"Title: {meta.title}",
            f"Summary: {meta.summary}",
            f"Heading path: {heading_path}",
            "---",
            chunk.content,
        ]
    )


def compute_stable_chunk_ids(
    file_rel_path: str,
    chunks: list[MarkdownChunk],
    embedding_input_meta: EmbeddingInputMeta,
) -> list[PlannedChunk]:
    occurrence_by_content: dict[str, int] = {}
    planned: list[PlannedChunk] = []

    for chunk_index, chunk in enumerate(chunks):
        occurrence = occurrence_by_content.get(chunk.content_sha256, 0)
        occurrence_by_content[chunk.content_sha256] = occurrence + 1
        chunk_id = _sha256_text(f"{file_rel_path}\n{chunk.content_sha256}\n{occurrence}")
        embedding_input = build_chunk_embedding_input(embedding_input_meta, chunk)
        planned.append(
            PlannedChunk(
                chunk_id=chunk_id,
                content=chunk.content,
                content_sha256=chunk.content_sha256,
                embedding_input=embedding_input,
                embedding_input_sha256=_sha256_text(embedding_input),
                chunk_index=chunk_index,
                heading=chunk.heading,
                heading_path_json=json.dumps(chunk.heading_path),
            )
        )

    return planned


def _log_line(logger: Callable[[str], None] | None, line: str) -> None:
    if logger is not None:
        logger(line)


def _write_text(writer: Callable[[str], None] | None, text: str) -> None:
    if writer is not None:
        writer(text)


def _rel_path_from_abs(vault_path: Path, abs_path: Path) -> str:
    return normalize_vault_rel_path(str(abs_path.relative_to(vault_path)))


def resolve_index_targets(
    conn: sqlite3.Connection,
    vault_path: Path,
    paths: list[str] | None,
) -> tuple[list[Path], set[str] | None, bool, int]:
    requested_paths = [value.strip() for value in (paths or []) if value.strip()]
    abs_paths: list[Path] = []
    is_full_vault_run = len(requested_paths) == 0
    deleted_files = 0

    if not is_full_vault_run:
        vault_root = vault_path.resolve()
        seen_abs_paths: set[Path] = set()

        for input_path in requested_paths:
            raw_candidate = Path(input_path)
            candidate_abs = (
                raw_candidate.resolve()
                if raw_candidate.is_absolute()
                else (vault_path / raw_candidate).resolve()
            )
            try:
                candidate_abs.relative_to(vault_root)
            except ValueError as error:
                raise ValueError(
                    f"Refusing to index a path outside the vault: {input_path}"
                ) from error

            if candidate_abs.suffix.lower() != ".md":
                continue

            rel_path = _rel_path_from_abs(vault_path, candidate_abs)
            if is_default_ignored_vault_rel_path(rel_path):
                continue

            if candidate_abs.exists():
                if candidate_abs in seen_abs_paths:
                    continue
                seen_abs_paths.add(candidate_abs)
                abs_paths.append(candidate_abs)
                continue

            delete_file_by_path(conn, rel_path)
            deleted_files += 1
    else:
        abs_paths.extend(list_markdown_files(vault_path))

    existing_rel_paths = (
        {_rel_path_from_abs(vault_path, abs_path) for abs_path in abs_paths}
        if is_full_vault_run
        else None
    )
    return abs_paths, existing_rel_paths, is_full_vault_run, deleted_files


def sync_file_metadata(
    conn: sqlite3.Connection,
    file: VaultMarkdownFile,
) -> tuple[str, EmbeddingInputMeta]:
    markdown = read_utf8_file(file.abs_path)
    parsed = parse_markdown_note(markdown)
    note_meta = normalize_ailss_note_meta(parsed.frontmatter)

    upsert_file(
        conn,
        path=file.rel_path,
        mtime_ms=file.mtime_ms,
        size_bytes=file.size,
        sha256=file.sha256,
    )
    upsert_note(
        conn,
        path=file.rel_path,
        note_id=note_meta.note_id,
        created=note_meta.created,
        title=note_meta.title,
        summary=note_meta.summary,
        entity=note_meta.entity,
        layer=note_meta.layer,
        status=note_meta.status,
        updated=note_meta.updated,
        frontmatter_json=json.dumps(note_meta.frontmatter),
    )
    replace_note_tags(conn, file.rel_path, note_meta.tags)
    replace_note_keywords(conn, file.rel_path, note_meta.keywords)
    replace_note_sources(conn, file.rel_path, note_meta.sources)
    replace_typed_links(conn, file.rel_path, note_meta.typed_links)
    return parsed.body, EmbeddingInputMeta(
        title=note_meta.title or "",
        summary=note_meta.summary or "",
    )


def plan_chunk_diff(
    conn: sqlite3.Connection,
    file_rel_path: str,
    body: str,
    max_chars: int,
    embedding_input_meta: EmbeddingInputMeta,
) -> ChunkDiffPlan:
    chunks = chunk_markdown_by_headings(body, max_chars=max_chars)
    planned_chunks = compute_stable_chunk_ids(file_rel_path, chunks, embedding_input_meta)

    existing_chunk_ids = set(list_chunk_ids_by_path(conn, file_rel_path))
    next_chunk_ids = {chunk.chunk_id for chunk in planned_chunks}
    to_delete = [chunk_id for chunk_id in existing_chunk_ids if chunk_id not in next_chunk_ids]

    existing_embedding_input_sha_by_chunk_id: dict[str, str] = {}
    embedding_by_input_sha: dict[str, list[float]] = {}
    for item in list_chunk_embeddings_by_path(conn, file_rel_path):
        existing_embedding_input_sha_by_chunk_id[item.chunk_id] = item.embedding_input_sha256
        if item.embedding_input_sha256 and item.embedding is not None:
            embedding_by_input_sha.setdefault(item.embedding_input_sha256, item.embedding)

    to_delete_set = set(to_delete)
    for planned in planned_chunks:
        if planned.chunk_id not in existing_chunk_ids:
            continue
        existing_input_sha = existing_embedding_input_sha_by_chunk_id.get(planned.chunk_id, "")
        if existing_input_sha != planned.embedding_input_sha256:
            to_delete_set.add(planned.chunk_id)

    existing_chunk_ids_after_delete = {
        chunk_id for chunk_id in existing_chunk_ids if chunk_id not in to_delete_set
    }

    to_embed: list[tuple[str, str]] = []
    seen_to_embed: set[str] = set()
    for planned in planned_chunks:
        if planned.chunk_id in existing_chunk_ids_after_delete:
            continue
        if planned.embedding_input_sha256 in embedding_by_input_sha:
            continue
        if planned.embedding_input_sha256 in seen_to_embed:
            continue
        seen_to_embed.add(planned.embedding_input_sha256)
        to_embed.append((planned.embedding_input_sha256, planned.embedding_input))

    return ChunkDiffPlan(
        planned_chunks=planned_chunks,
        existing_chunk_ids_after_delete=existing_chunk_ids_after_delete,
        to_delete=sorted(to_delete_set),
        embedding_by_input_sha=embedding_by_input_sha,
        to_embed=to_embed,
    )


def acquire_chunk_embeddings(
    openai_client: OpenAI,
    embedding_model: str,
    plan: ChunkDiffPlan,
    batch_size: int,
    writer: Callable[[str], None] | None,
) -> None:
    for index in range(0, len(plan.to_embed), batch_size):
        batch = plan.to_embed[index : index + batch_size]
        response = openai_client.embeddings.create(
            model=embedding_model,
            input=[embedding_input for _, embedding_input in batch],
            encoding_format="float",
        )
        if len(response.data) != len(batch):
            raise RuntimeError(
                "Embedding response returned too few embeddings. "
                f"batchSize={len(batch)}, got={len(response.data)}"
            )
        for batch_index, (embedding_input_sha256, _) in enumerate(batch):
            embedding = response.data[batch_index].embedding
            plan.embedding_by_input_sha[embedding_input_sha256] = [
                float(value) for value in embedding
            ]
        _write_text(
            writer,
            f"[chunks] {min(index + len(batch), len(plan.to_embed))}/{len(plan.to_embed)}\r",
        )
    _write_text(writer, "\n")


def apply_chunk_writes(
    conn: sqlite3.Connection,
    file_rel_path: str,
    plan: ChunkDiffPlan,
) -> None:
    for planned in plan.planned_chunks:
        if planned.chunk_id not in plan.existing_chunk_ids_after_delete:
            continue
        update_chunk_metadata(
            conn,
            chunk_id=planned.chunk_id,
            path=file_rel_path,
            chunk_index=planned.chunk_index,
            heading=planned.heading,
            heading_path_json=planned.heading_path_json,
            content=planned.content,
            content_sha256=planned.content_sha256,
            embedding_input_sha256=planned.embedding_input_sha256,
        )

    for planned in plan.planned_chunks:
        if planned.chunk_id in plan.existing_chunk_ids_after_delete:
            continue
        embedding = plan.embedding_by_input_sha.get(planned.embedding_input_sha256)
        if embedding is None:
            raise RuntimeError(
                "Missing embedding for chunk insertion. "
                f"path={file_rel_path}, embeddingInputSha256={planned.embedding_input_sha256}"
            )
        insert_chunk_with_embedding(
            conn,
            chunk_id=planned.chunk_id,
            path=file_rel_path,
            chunk_index=planned.chunk_index,
            heading=planned.heading,
            heading_path_json=planned.heading_path_json,
            content=planned.content,
            content_sha256=planned.content_sha256,
            embedding_input_sha256=planned.embedding_input_sha256,
            embedding=embedding,
        )


def index_vault(options: IndexVaultOptions) -> IndexVaultSummary:
    max_chars = max(1, options.max_chars)
    batch_size = max(1, options.batch_size)

    abs_paths, existing_rel_paths, is_full_vault_run, deleted_files = resolve_index_targets(
        options.conn,
        options.vault_path,
        options.paths,
    )
    _log_line(options.logger_log, f"[ailss-indexer] vault={options.vault_path}")
    _log_line(options.logger_log, f"[ailss-indexer] db={options.db_path_for_log}")
    _log_line(options.logger_log, f"[ailss-indexer] files={len(abs_paths)}")

    changed_files = 0
    indexed_chunks = 0

    for abs_path in abs_paths:
        file = stat_markdown_file(options.vault_path, abs_path)
        prev_sha = get_file_sha256(options.conn, file.rel_path)
        sha_unchanged = bool(prev_sha) and prev_sha == file.sha256
        if sha_unchanged and not is_full_vault_run:
            continue

        needs_embedding_update = not sha_unchanged
        _log_line(options.logger_log, "")
        _log_line(
            options.logger_log,
            f"[{'index' if needs_embedding_update else 'meta'}] {file.rel_path}",
        )
        if needs_embedding_update:
            changed_files += 1

        body, embedding_input_meta = sync_file_metadata(options.conn, file)
        if not needs_embedding_update:
            options.conn.commit()
            continue

        plan = plan_chunk_diff(
            options.conn,
            file.rel_path,
            body,
            max_chars,
            embedding_input_meta,
        )
        delete_chunks_by_ids(options.conn, plan.to_delete)
        acquire_chunk_embeddings(
            options.openai,
            options.embedding_model,
            plan,
            batch_size,
            options.logger_write,
        )
        apply_chunk_writes(options.conn, file.rel_path, plan)
        options.conn.commit()

        indexed_chunks += len(plan.planned_chunks)
        _log_line(options.logger_log, f"[done] chunks={len(plan.planned_chunks)}")

    if existing_rel_paths is not None:
        for indexed_path in list_file_paths(options.conn):
            if indexed_path in existing_rel_paths:
                continue
            delete_file_by_path(options.conn, indexed_path)
            deleted_files += 1
        options.conn.commit()

    _log_line(options.logger_log, "")
    _log_line(
        options.logger_log,
        "[summary] "
        + (
            f"changedFiles={changed_files}, indexedChunks={indexed_chunks}, "
            f"deletedFiles={deleted_files}"
        ),
    )
    return IndexVaultSummary(
        changed_files=changed_files,
        indexed_chunks=indexed_chunks,
        deleted_files=deleted_files,
    )
