from __future__ import annotations

import json
import sqlite3

from .index_db_types import ChunkEmbeddingCacheItem
from .index_db_utils import now_iso, safe_parse_embedding
from .vault_runtime import TypedLinkRecord


def upsert_file(
    conn: sqlite3.Connection,
    *,
    path: str,
    mtime_ms: int,
    size_bytes: int,
    sha256: str,
) -> None:
    conn.execute(
        """
        INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          mtime_ms=excluded.mtime_ms,
          size_bytes=excluded.size_bytes,
          sha256=excluded.sha256,
          updated_at=excluded.updated_at
        """,
        (path, int(mtime_ms), size_bytes, sha256, now_iso()),
    )


def get_file_sha256(conn: sqlite3.Connection, file_path: str) -> str | None:
    row = conn.execute("SELECT sha256 FROM files WHERE path = ?", (file_path,)).fetchone()
    if row is None or row["sha256"] is None:
        return None
    return str(row["sha256"])


def list_file_paths(conn: sqlite3.Connection) -> list[str]:
    return [str(row["path"]) for row in conn.execute("SELECT path FROM files ORDER BY path ASC")]


def delete_file_by_path(conn: sqlite3.Connection, file_path: str) -> None:
    delete_chunks_by_path(conn, file_path)
    conn.execute("DELETE FROM files WHERE path = ?", (file_path,))


def delete_chunks_by_path(conn: sqlite3.Connection, file_path: str) -> None:
    rowids = [
        int(row["rowid"])
        for row in conn.execute(
            'SELECT "rowid" FROM chunk_rowids WHERE chunk_id IN '
            "(SELECT chunk_id FROM chunks WHERE path = ?)",
            (file_path,),
        ).fetchall()
        if row["rowid"] is not None
    ]
    for rowid in rowids:
        conn.execute("DELETE FROM chunk_embeddings WHERE rowid = ?", (rowid,))
    conn.execute("DELETE FROM chunks WHERE path = ?", (file_path,))


def list_chunk_ids_by_path(conn: sqlite3.Connection, file_path: str) -> list[str]:
    return [
        str(row["chunk_id"])
        for row in conn.execute("SELECT chunk_id FROM chunks WHERE path = ?", (file_path,))
        if row["chunk_id"] is not None
    ]


def list_chunk_embeddings_by_path(
    conn: sqlite3.Connection,
    file_path: str,
) -> list[ChunkEmbeddingCacheItem]:
    rows = conn.execute(
        """
        SELECT
          c.chunk_id AS chunk_id,
          c.embedding_input_sha256 AS embedding_input_sha256,
          e.embedding AS embedding
        FROM chunks c
        JOIN chunk_rowids r ON r.chunk_id = c.chunk_id
        JOIN chunk_embeddings e ON e.rowid = r.rowid
        WHERE c.path = ?
        """,
        (file_path,),
    ).fetchall()
    results: list[ChunkEmbeddingCacheItem] = []
    for row in rows:
        chunk_id = str(row["chunk_id"]) if row["chunk_id"] is not None else ""
        if not chunk_id:
            continue
        embedding_input_sha256 = (
            str(row["embedding_input_sha256"]) if row["embedding_input_sha256"] is not None else ""
        )
        results.append(
            ChunkEmbeddingCacheItem(
                chunk_id=chunk_id,
                embedding_input_sha256=embedding_input_sha256,
                embedding=safe_parse_embedding(row["embedding"]),
            )
        )
    return results


def delete_chunks_by_ids(conn: sqlite3.Connection, chunk_ids: list[str]) -> None:
    ids = [chunk_id.strip() for chunk_id in chunk_ids if chunk_id.strip()]
    if not ids:
        return

    batch_size = 200
    for index in range(0, len(ids), batch_size):
        batch = ids[index : index + batch_size]
        placeholders = ", ".join("?" for _ in batch)
        rowids = [
            int(row["rowid"])
            for row in conn.execute(
                f'SELECT "rowid" FROM chunk_rowids WHERE chunk_id IN ({placeholders})',
                batch,
            ).fetchall()
            if row["rowid"] is not None
        ]
        for rowid in rowids:
            conn.execute("DELETE FROM chunk_embeddings WHERE rowid = ?", (rowid,))
        conn.execute(f"DELETE FROM chunks WHERE chunk_id IN ({placeholders})", batch)


def insert_chunk_with_embedding(
    conn: sqlite3.Connection,
    *,
    chunk_id: str,
    path: str,
    chunk_index: int,
    heading: str | None,
    heading_path_json: str,
    content: str,
    content_sha256: str,
    embedding_input_sha256: str,
    embedding: list[float],
) -> None:
    conn.execute(
        """
        INSERT INTO chunks(
          chunk_id,
          path,
          chunk_index,
          heading,
          heading_path_json,
          content,
          content_sha256,
          embedding_input_sha256,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            chunk_id,
            path,
            int(chunk_index),
            heading,
            heading_path_json,
            content,
            content_sha256,
            embedding_input_sha256,
            now_iso(),
        ),
    )
    cursor = conn.execute(
        "INSERT INTO chunk_embeddings(embedding) VALUES (?)",
        (json.dumps(embedding),),
    )
    rowid = cursor.lastrowid
    if rowid is None:
        raise RuntimeError(f"Failed to allocate vector rowid for chunk={chunk_id}")
    conn.execute(
        'INSERT INTO chunk_rowids(chunk_id, "rowid") VALUES (?, ?)',
        (chunk_id, int(rowid)),
    )


def update_chunk_metadata(
    conn: sqlite3.Connection,
    *,
    chunk_id: str,
    path: str,
    chunk_index: int,
    heading: str | None,
    heading_path_json: str,
    content: str,
    content_sha256: str,
    embedding_input_sha256: str,
) -> None:
    conn.execute(
        """
        UPDATE chunks
        SET
          path = ?,
          chunk_index = ?,
          heading = ?,
          heading_path_json = ?,
          content = ?,
          content_sha256 = ?,
          embedding_input_sha256 = ?,
          updated_at = ?
        WHERE chunk_id = ?
        """,
        (
            path,
            int(chunk_index),
            heading,
            heading_path_json,
            content,
            content_sha256,
            embedding_input_sha256,
            now_iso(),
            chunk_id,
        ),
    )


def list_chunks_by_path_and_indices(
    conn: sqlite3.Connection,
    file_path: str,
    indices: list[int],
) -> list[sqlite3.Row]:
    wanted = sorted({int(index) for index in indices if int(index) >= 0})
    if not wanted:
        return []
    placeholders = ", ".join("?" for _ in wanted)
    return conn.execute(
        f"""
        SELECT
          chunk_id,
          chunk_index,
          heading,
          heading_path_json,
          content
        FROM chunks
        WHERE path = ?
          AND chunk_index IN ({placeholders})
        ORDER BY chunk_index ASC
        """,
        [file_path, *wanted],
    ).fetchall()


def upsert_note(
    conn: sqlite3.Connection,
    *,
    path: str,
    note_id: str | None,
    created: str | None,
    title: str | None,
    summary: str | None,
    entity: str | None,
    layer: str | None,
    status: str | None,
    updated: str | None,
    frontmatter_json: str,
) -> None:
    conn.execute(
        """
        INSERT INTO notes(
          path, note_id, created, title, summary,
          entity, layer, status, updated,
          frontmatter_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          note_id=excluded.note_id,
          created=excluded.created,
          title=excluded.title,
          summary=excluded.summary,
          entity=excluded.entity,
          layer=excluded.layer,
          status=excluded.status,
          updated=excluded.updated,
          frontmatter_json=excluded.frontmatter_json,
          updated_at=excluded.updated_at
        """,
        (
            path,
            note_id,
            created,
            title,
            summary,
            entity,
            layer,
            status,
            updated,
            frontmatter_json,
            now_iso(),
        ),
    )


def _replace_note_list_table(
    conn: sqlite3.Connection,
    *,
    table: str,
    column: str,
    note_path: str,
    values: list[str],
) -> None:
    conn.execute(f"DELETE FROM {table} WHERE path = ?", (note_path,))
    for value in values:
        conn.execute(f"INSERT INTO {table}(path, {column}) VALUES (?, ?)", (note_path, value))


def replace_note_tags(conn: sqlite3.Connection, note_path: str, tags: list[str]) -> None:
    _replace_note_list_table(
        conn,
        table="note_tags",
        column="tag",
        note_path=note_path,
        values=tags,
    )


def replace_note_keywords(conn: sqlite3.Connection, note_path: str, keywords: list[str]) -> None:
    _replace_note_list_table(
        conn,
        table="note_keywords",
        column="keyword",
        note_path=note_path,
        values=keywords,
    )


def replace_note_sources(conn: sqlite3.Connection, note_path: str, sources: list[str]) -> None:
    _replace_note_list_table(
        conn,
        table="note_sources",
        column="source",
        note_path=note_path,
        values=sources,
    )


def replace_typed_links(
    conn: sqlite3.Connection,
    from_path: str,
    links: list[TypedLinkRecord],
) -> None:
    conn.execute("DELETE FROM typed_links WHERE from_path = ?", (from_path,))
    for link in links:
        conn.execute(
            """
            INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                from_path,
                link.rel,
                link.to_target,
                link.to_wikilink,
                link.position,
                now_iso(),
            ),
        )
