from __future__ import annotations

import json
import sqlite3
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

import sqlite_vec  # type: ignore[import-untyped]

from .vault_runtime import TypedLinkRecord

EMBEDDING_INPUT_VERSION = "title-summary-heading-path-v1"


@dataclass(frozen=True)
class OpenIndexDbOptions:
    db_path: Path
    embedding_model: str
    embedding_dim: int


@dataclass(frozen=True)
class ChunkEmbeddingCacheItem:
    chunk_id: str
    embedding_input_sha256: str
    embedding: list[float] | None


@dataclass(frozen=True)
class TypedLinkBackref:
    from_path: str
    from_title: str | None
    rel: str
    to_target: str
    to_wikilink: str


@dataclass(frozen=True)
class TypedLinkRelFacet:
    rel: str
    count: int


@dataclass(frozen=True)
class ResolvedNoteTarget:
    path: str
    title: str | None
    matched_by: Literal["path", "note_id", "title"]


@dataclass(frozen=True)
class IndexNoteMeta:
    path: str
    note_id: str | None
    created: str | None
    title: str | None
    summary: str | None
    entity: str | None
    layer: str | None
    status: str | None
    updated: str | None
    tags: list[str]
    keywords: list[str]
    sources: list[str]
    frontmatter: dict[str, object]
    typed_links: list[TypedLinkRecord]


@dataclass(frozen=True)
class SearchNotesFilters:
    path_prefix: str | None = None
    title_query: str | None = None
    note_id: str | list[str] | None = None
    entity: str | list[str] | None = None
    layer: str | list[str] | None = None
    status: str | list[str] | None = None
    created_from: str | None = None
    created_to: str | None = None
    updated_from: str | None = None
    updated_to: str | None = None
    tags_any: list[str] | None = None
    tags_all: list[str] | None = None
    keywords_any: list[str] | None = None
    sources_any: list[str] | None = None
    order_by: Literal["path", "created", "updated"] = "path"
    order_dir: Literal["asc", "desc"] = "asc"
    limit: int = 50


@dataclass(frozen=True)
class SearchNotesResult:
    path: str
    note_id: str | None
    created: str | None
    title: str | None
    summary: str | None
    entity: str | None
    layer: str | None
    status: str | None
    updated: str | None
    tags: list[str]
    keywords: list[str]
    sources: list[str]


@dataclass(frozen=True)
class TypedLinkQuery:
    rel: str | None = None
    rels: list[str] | None = None
    to_target: str | None = None
    limit: int = 100


@dataclass(frozen=True)
class TypedLinkRelFacetQuery:
    path_prefix: str | None = None
    limit: int = 200
    order_by: Literal["count_desc", "rel_asc"] = "count_desc"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def embedding_dim_for_model(model: str) -> int:
    if model == "text-embedding-3-large":
        return 3072
    return 1536


def resolve_default_db_path(vault_path: Path) -> Path:
    db_dir = vault_path / ".ailss"
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir / "index.sqlite"


def open_index_db(options: OpenIndexDbOptions) -> sqlite3.Connection:
    conn = sqlite3.connect(options.db_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        migrate_index_db(conn, options)
        return conn
    except Exception:
        with suppress(sqlite3.Error):
            conn.enable_load_extension(False)
        conn.close()
        raise


def migrate_index_db(conn: sqlite3.Connection, options: OpenIndexDbOptions) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS files (
          path TEXT PRIMARY KEY,
          mtime_ms INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
          chunk_id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          heading TEXT,
          heading_path_json TEXT NOT NULL,
          content TEXT NOT NULL,
          content_sha256 TEXT NOT NULL,
          embedding_input_sha256 TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
        );
        """
    )

    chunk_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(chunks)").fetchall()
        if row["name"] is not None
    }
    if "chunk_index" not in chunk_columns:
        conn.execute("ALTER TABLE chunks ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0")
    if "embedding_input_sha256" not in chunk_columns:
        conn.execute(
            "ALTER TABLE chunks ADD COLUMN embedding_input_sha256 TEXT NOT NULL DEFAULT ''"
        )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_path_chunk_index ON chunks(path, chunk_index)"
    )

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS db_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )

    has_any_chunks = conn.execute("SELECT 1 FROM chunks LIMIT 1").fetchone() is not None

    existing_model = _get_db_meta(conn, "embedding_model")
    existing_dim_raw = _get_db_meta(conn, "embedding_dim")
    existing_embedding_input_version = _get_db_meta(conn, "embedding_input_version")
    existing_dim = (
        int(existing_dim_raw) if existing_dim_raw and existing_dim_raw.isdigit() else None
    )

    missing_meta = not existing_model or not existing_dim_raw or existing_dim is None
    if missing_meta:
        if has_any_chunks:
            raise RuntimeError(
                "Index DB does not record the embedding model/dimension "
                "(likely created by an older AILSS version). Refusing to continue to avoid "
                "mixing incompatible embeddings in one DB. "
                f"DB path: {options.db_path} "
                "Fix: delete the DB and reindex (or choose a new --db path)."
            )
        _set_db_meta(conn, "embedding_model", options.embedding_model)
        _set_db_meta(conn, "embedding_dim", str(options.embedding_dim))
    elif existing_model != options.embedding_model or existing_dim != options.embedding_dim:
        raise RuntimeError(
            "Embedding config mismatch for the index DB. "
            f"DB path: {options.db_path} "
            f"DB expects: model={existing_model}, dim={existing_dim_raw} "
            f"Current run: model={options.embedding_model}, dim={options.embedding_dim} "
            "Fix: delete the DB and reindex (or choose a new --db path)."
        )

    if not existing_embedding_input_version:
        if has_any_chunks:
            raise RuntimeError(
                "Index DB does not record the embedding input format version. "
                "Refusing to continue to avoid mixing embeddings built from different input "
                f"formats in one DB. DB path: {options.db_path} "
                "Fix: delete the DB and reindex (or choose a new --db path)."
            )
        _set_db_meta(conn, "embedding_input_version", EMBEDDING_INPUT_VERSION)
    elif existing_embedding_input_version != EMBEDDING_INPUT_VERSION:
        raise RuntimeError(
            "Embedding input format mismatch for the index DB. "
            f"DB path: {options.db_path} "
            f"DB expects: embedding_input_version={existing_embedding_input_version} "
            f"Current run: embedding_input_version={EMBEDDING_INPUT_VERSION} "
            "Fix: delete the DB and reindex (or choose a new --db path)."
        )

    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS chunk_rowids (
          chunk_id TEXT PRIMARY KEY,
          rowid INTEGER UNIQUE NOT NULL,
          FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
          embedding FLOAT[{options.embedding_dim}]
        );

        DROP VIEW IF EXISTS chunks_with_rowid;
        CREATE VIEW IF NOT EXISTS chunks_with_rowid AS
        SELECT
          c.chunk_id,
          r.rowid AS embedding_rowid,
          c.path,
          c.chunk_index,
          c.heading,
          c.heading_path_json,
          c.content,
          c.content_sha256,
          c.embedding_input_sha256,
          c.updated_at
        FROM chunks c
        JOIN chunk_rowids r ON r.chunk_id = c.chunk_id;

        CREATE TABLE IF NOT EXISTS notes (
          path TEXT PRIMARY KEY,
          note_id TEXT,
          created TEXT,
          title TEXT,
          summary TEXT,
          entity TEXT,
          layer TEXT,
          status TEXT,
          updated TEXT,
          frontmatter_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity);
        CREATE INDEX IF NOT EXISTS idx_notes_layer ON notes(layer);
        CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
        CREATE INDEX IF NOT EXISTS idx_notes_note_id ON notes(note_id);

        CREATE TABLE IF NOT EXISTS note_tags (
          path TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY(path, tag),
          FOREIGN KEY(path) REFERENCES notes(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

        CREATE TABLE IF NOT EXISTS note_keywords (
          path TEXT NOT NULL,
          keyword TEXT NOT NULL,
          PRIMARY KEY(path, keyword),
          FOREIGN KEY(path) REFERENCES notes(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_keywords_keyword ON note_keywords(keyword);

        CREATE TABLE IF NOT EXISTS note_sources (
          path TEXT NOT NULL,
          source TEXT NOT NULL,
          PRIMARY KEY(path, source),
          FOREIGN KEY(path) REFERENCES notes(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_sources_source ON note_sources(source);

        CREATE TABLE IF NOT EXISTS typed_links (
          from_path TEXT NOT NULL,
          rel TEXT NOT NULL,
          to_target TEXT NOT NULL,
          to_wikilink TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(from_path, rel, to_target, position),
          FOREIGN KEY(from_path) REFERENCES notes(path) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_typed_links_from_rel ON typed_links(from_path, rel);
        CREATE INDEX IF NOT EXISTS idx_typed_links_rel_to ON typed_links(rel, to_target);
        """
    )
    conn.commit()


def _get_db_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM db_meta WHERE key = ?", (key,)).fetchone()
    if row is None:
        return None
    value = row["value"]
    return str(value) if value is not None else None


def _set_db_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO db_meta(key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value=excluded.value,
          updated_at=excluded.updated_at
        """,
        (key, value, now_iso()),
    )


def safe_parse_embedding(value: object) -> list[float] | None:
    if isinstance(value, list) and all(isinstance(item, (int, float)) for item in value):
        return [float(item) for item in value]
    if isinstance(value, (str, bytes)):
        try:
            text = value if isinstance(value, str) else value.decode("utf-8")
            parsed = json.loads(text)
        except (UnicodeDecodeError, ValueError):
            return None
        if isinstance(parsed, list) and all(isinstance(item, (int, float)) for item in parsed):
            return [float(item) for item in parsed]
    return None


def safe_parse_json_object(input_text: str) -> dict[str, object]:
    try:
        value = json.loads(input_text)
    except ValueError:
        return {}
    if isinstance(value, dict):
        return {str(key): value[key] for key in value}
    return {}


def safe_parse_json_array(input_text: str) -> list[str]:
    try:
        value = json.loads(input_text)
    except ValueError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def normalize_string_list(input_value: str | list[str] | None) -> list[str] | None:
    if isinstance(input_value, str):
        return [input_value]
    if isinstance(input_value, list):
        return [item for item in input_value if isinstance(item, str)]
    return None


def escape_sql_like_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def to_literal_prefix_like_pattern(prefix: str) -> str:
    return f"{escape_sql_like_literal(prefix)}%"


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


def get_note_meta(conn: sqlite3.Connection, note_path: str) -> IndexNoteMeta | None:
    note = conn.execute("SELECT * FROM notes WHERE path = ?", (note_path,)).fetchone()
    if note is None:
        return None

    tags = [
        str(row["tag"])
        for row in conn.execute(
            "SELECT tag FROM note_tags WHERE path = ? ORDER BY tag", (note_path,)
        ).fetchall()
        if row["tag"] is not None
    ]
    keywords = [
        str(row["keyword"])
        for row in conn.execute(
            "SELECT keyword FROM note_keywords WHERE path = ? ORDER BY keyword", (note_path,)
        ).fetchall()
        if row["keyword"] is not None
    ]
    sources = [
        str(row["source"])
        for row in conn.execute(
            "SELECT source FROM note_sources WHERE path = ? ORDER BY source", (note_path,)
        ).fetchall()
        if row["source"] is not None
    ]
    typed_links = [
        TypedLinkRecord(
            rel=str(row["rel"]),
            to_target=str(row["to_target"]),
            to_wikilink=str(row["to_wikilink"]),
            position=int(row["position"]),
        )
        for row in conn.execute(
            """
            SELECT rel, to_target, to_wikilink, position
            FROM typed_links
            WHERE from_path = ?
            ORDER BY rel, position
            """,
            (note_path,),
        ).fetchall()
    ]
    frontmatter_json = (
        str(note["frontmatter_json"]) if note["frontmatter_json"] is not None else "{}"
    )

    return IndexNoteMeta(
        path=str(note["path"]),
        note_id=str(note["note_id"]) if note["note_id"] is not None else None,
        created=str(note["created"]) if note["created"] is not None else None,
        title=str(note["title"]) if note["title"] is not None else None,
        summary=str(note["summary"]) if note["summary"] is not None else None,
        entity=str(note["entity"]) if note["entity"] is not None else None,
        layer=str(note["layer"]) if note["layer"] is not None else None,
        status=str(note["status"]) if note["status"] is not None else None,
        updated=str(note["updated"]) if note["updated"] is not None else None,
        tags=tags,
        keywords=keywords,
        sources=sources,
        frontmatter=safe_parse_json_object(frontmatter_json),
        typed_links=typed_links,
    )


def list_tags(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, object]]:
    effective_limit = min(max(1, limit), 5000)
    return [
        {"tag": str(row["tag"]), "count": int(row["count"])}
        for row in conn.execute(
            """
            SELECT tag, COUNT(*) AS count
            FROM note_tags
            GROUP BY tag
            ORDER BY count DESC, tag ASC
            LIMIT ?
            """,
            (effective_limit,),
        ).fetchall()
    ]


def list_keywords(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, object]]:
    effective_limit = min(max(1, limit), 5000)
    return [
        {"keyword": str(row["keyword"]), "count": int(row["count"])}
        for row in conn.execute(
            """
            SELECT keyword, COUNT(*) AS count
            FROM note_keywords
            GROUP BY keyword
            ORDER BY count DESC, keyword ASC
            LIMIT ?
            """,
            (effective_limit,),
        ).fetchall()
    ]


def search_notes(
    conn: sqlite3.Connection,
    filters: SearchNotesFilters | None = None,
) -> list[SearchNotesResult]:
    effective_filters = filters or SearchNotesFilters()
    where: list[str] = []
    params: list[object] = []

    if effective_filters.path_prefix:
        where.append("notes.path LIKE ? ESCAPE '\\'")
        params.append(to_literal_prefix_like_pattern(effective_filters.path_prefix))

    if effective_filters.title_query:
        where.append("notes.title LIKE ?")
        params.append(f"%{effective_filters.title_query}%")

    for column_name, raw_values in (
        ("note_id", normalize_string_list(effective_filters.note_id)),
        ("entity", normalize_string_list(effective_filters.entity)),
        ("layer", normalize_string_list(effective_filters.layer)),
        ("status", normalize_string_list(effective_filters.status)),
    ):
        if not raw_values:
            continue
        placeholders = ", ".join("?" for _ in raw_values)
        where.append(f"notes.{column_name} IN ({placeholders})")
        params.extend(raw_values)

    if effective_filters.created_from:
        where.append("notes.created IS NOT NULL AND notes.created >= ?")
        params.append(effective_filters.created_from)
    if effective_filters.created_to:
        where.append("notes.created IS NOT NULL AND notes.created <= ?")
        params.append(effective_filters.created_to)
    if effective_filters.updated_from:
        where.append("notes.updated IS NOT NULL AND notes.updated >= ?")
        params.append(effective_filters.updated_from)
    if effective_filters.updated_to:
        where.append("notes.updated IS NOT NULL AND notes.updated <= ?")
        params.append(effective_filters.updated_to)

    tags_any = [tag for tag in effective_filters.tags_any or [] if tag]
    if tags_any:
        placeholders = ", ".join("?" for _ in tags_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag IN "
            f"({placeholders}))"
        )
        params.extend(tags_any)

    for tag in [tag for tag in effective_filters.tags_all or [] if tag]:
        where.append("EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag = ?)")
        params.append(tag)

    keywords_any = [keyword for keyword in effective_filters.keywords_any or [] if keyword]
    if keywords_any:
        placeholders = ", ".join("?" for _ in keywords_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_keywords k WHERE k.path = notes.path "
            f"AND k.keyword IN ({placeholders}))"
        )
        params.extend(keywords_any)

    sources_any = [source for source in effective_filters.sources_any or [] if source]
    if sources_any:
        placeholders = ", ".join("?" for _ in sources_any)
        where.append(
            "EXISTS (SELECT 1 FROM note_sources s WHERE s.path = notes.path "
            f"AND s.source IN ({placeholders}))"
        )
        params.extend(sources_any)

    limit = min(max(1, effective_filters.limit), 500)
    order_dir = "DESC" if effective_filters.order_dir == "desc" else "ASC"
    if effective_filters.order_by == "created":
        order_sql = f"notes.created IS NULL, notes.created {order_dir}, notes.path"
    elif effective_filters.order_by == "updated":
        order_sql = f"notes.updated IS NULL, notes.updated {order_dir}, notes.path"
    else:
        order_sql = f"notes.path {order_dir}"

    rows = conn.execute(
        f"""
        SELECT path, note_id, created, title, summary, entity, layer, status, updated
        FROM notes
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY {order_sql}
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    if not rows:
        return []

    paths = [str(row["path"]) for row in rows]
    placeholders = ", ".join("?" for _ in paths)

    tags_by_path = _load_grouped_string_rows(conn, "note_tags", "tag", paths, placeholders)
    keywords_by_path = _load_grouped_string_rows(
        conn, "note_keywords", "keyword", paths, placeholders
    )
    sources_by_path = _load_grouped_string_rows(conn, "note_sources", "source", paths, placeholders)

    return [
        SearchNotesResult(
            path=str(row["path"]),
            note_id=str(row["note_id"]) if row["note_id"] is not None else None,
            created=str(row["created"]) if row["created"] is not None else None,
            title=str(row["title"]) if row["title"] is not None else None,
            summary=str(row["summary"]) if row["summary"] is not None else None,
            entity=str(row["entity"]) if row["entity"] is not None else None,
            layer=str(row["layer"]) if row["layer"] is not None else None,
            status=str(row["status"]) if row["status"] is not None else None,
            updated=str(row["updated"]) if row["updated"] is not None else None,
            tags=tags_by_path.get(str(row["path"]), []),
            keywords=keywords_by_path.get(str(row["path"]), []),
            sources=sources_by_path.get(str(row["path"]), []),
        )
        for row in rows
    ]


def _load_grouped_string_rows(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    paths: list[str],
    placeholders: str,
) -> dict[str, list[str]]:
    rows = conn.execute(
        f"SELECT path, {column} FROM {table} WHERE path IN ({placeholders}) ORDER BY {column}",
        paths,
    ).fetchall()
    grouped: dict[str, list[str]] = {}
    for row in rows:
        path = str(row["path"])
        value = str(row[column])
        grouped.setdefault(path, []).append(value)
    return grouped


def find_notes_by_typed_link(
    conn: sqlite3.Connection,
    query: TypedLinkQuery,
) -> list[TypedLinkBackref]:
    where: list[str] = []
    params: list[object] = []

    if query.rel:
        where.append("tl.rel = ?")
        params.append(query.rel)
    if query.to_target:
        where.append("tl.to_target = ?")
        params.append(query.to_target)
    if query.rels:
        rels = [rel.strip() for rel in query.rels if rel.strip()]
        if rels:
            placeholders = ", ".join("?" for _ in rels)
            where.append(f"tl.rel IN ({placeholders})")
            params.extend(rels)

    limit = min(max(1, query.limit), 1000)
    rows = conn.execute(
        f"""
        SELECT
          tl.from_path AS from_path,
          n.title AS from_title,
          tl.rel AS rel,
          tl.to_target AS to_target,
          tl.to_wikilink AS to_wikilink
        FROM typed_links tl
        JOIN notes n ON n.path = tl.from_path
        {"WHERE " + " AND ".join(where) if where else ""}
        ORDER BY tl.rel, tl.to_target, tl.from_path, tl.position
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return [
        TypedLinkBackref(
            from_path=str(row["from_path"]),
            from_title=str(row["from_title"]) if row["from_title"] is not None else None,
            rel=str(row["rel"]),
            to_target=str(row["to_target"]),
            to_wikilink=str(row["to_wikilink"]),
        )
        for row in rows
    ]


def list_typed_link_rels(
    conn: sqlite3.Connection,
    query: TypedLinkRelFacetQuery | None = None,
) -> list[TypedLinkRelFacet]:
    effective_query = query or TypedLinkRelFacetQuery()
    where: list[str] = []
    params: list[object] = []

    path_prefix = effective_query.path_prefix.strip() if effective_query.path_prefix else ""
    if path_prefix:
        where.append("from_path LIKE ? ESCAPE '\\'")
        params.append(to_literal_prefix_like_pattern(path_prefix))

    limit = min(max(1, effective_query.limit), 5000)
    order_sql = (
        "ORDER BY rel ASC, count DESC"
        if effective_query.order_by == "rel_asc"
        else "ORDER BY count DESC, rel ASC"
    )
    rows = conn.execute(
        f"""
        SELECT rel, COUNT(*) AS count
        FROM typed_links
        {"WHERE " + " AND ".join(where) if where else ""}
        GROUP BY rel
        {order_sql}
        LIMIT ?
        """,
        [*params, limit],
    ).fetchall()
    return [TypedLinkRelFacet(rel=str(row["rel"]), count=int(row["count"])) for row in rows]


def resolve_note_paths_by_wikilink_target(
    conn: sqlite3.Connection,
    target: str,
    limit: int = 20,
) -> list[ResolvedNoteTarget]:
    trimmed = target.strip()
    if not trimmed:
        return []

    effective_limit = min(max(1, limit), 200)
    target_no_ext = trimmed[:-3] if trimmed.lower().endswith(".md") else trimmed
    target_with_ext = trimmed if trimmed.lower().endswith(".md") else f"{trimmed}.md"

    path_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE path = ? OR path LIKE ?
        ORDER BY path
        LIMIT ?
        """,
        (target_with_ext, f"%/{target_with_ext}", effective_limit),
    ).fetchall()
    note_id_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE note_id = ?
        ORDER BY path
        LIMIT ?
        """,
        (target_no_ext, effective_limit),
    ).fetchall()
    title_matches = conn.execute(
        """
        SELECT path, title
        FROM notes
        WHERE title = ?
        ORDER BY path
        LIMIT ?
        """,
        (target_no_ext, effective_limit),
    ).fetchall()

    results: list[ResolvedNoteTarget] = []
    seen_paths: set[str] = set()

    def append_rows(
        rows: list[sqlite3.Row],
        matched_by: Literal["path", "note_id", "title"],
    ) -> None:
        for row in rows:
            path = str(row["path"])
            if path in seen_paths:
                continue
            seen_paths.add(path)
            results.append(
                ResolvedNoteTarget(
                    path=path,
                    title=str(row["title"]) if row["title"] is not None else None,
                    matched_by=matched_by,
                )
            )
            if len(results) >= effective_limit:
                return

    append_rows(path_matches, "path")
    if len(results) < effective_limit:
        append_rows(note_id_matches, "note_id")
    if len(results) < effective_limit:
        append_rows(title_matches, "title")
    return results
