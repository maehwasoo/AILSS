from __future__ import annotations

import sqlite3
from contextlib import suppress
from pathlib import Path

import sqlite_vec  # type: ignore[import-untyped]

from .index_db_types import OpenIndexDbOptions
from .index_db_utils import now_iso

EMBEDDING_INPUT_VERSION = "title-summary-heading-path-v1"


def embedding_dim_for_model(model: str) -> int:
    if model == "text-embedding-3-large":
        return 3072
    return 1536


def resolve_default_db_path(vault_path: Path) -> Path:
    db_dir = vault_path / ".ailss"
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir / "index.sqlite"


def open_index_db(options: OpenIndexDbOptions) -> sqlite3.Connection:
    options.db_path.parent.mkdir(parents=True, exist_ok=True)
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
