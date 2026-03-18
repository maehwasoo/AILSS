from __future__ import annotations

import sqlite3
from contextlib import closing, suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import sqlite_vec  # type: ignore[import-untyped]

from .config import Settings
from .models import HealthChecks, HealthResponse

BASE_REQUIRED_TABLES = {"chunks", "db_meta", "note_tags", "notes"}
VECTOR_REQUIRED_TABLES = {"chunk_embeddings", "chunk_rowids"}
BASE_REQUIRED_COLUMNS = {
    "chunks": frozenset(
        {"chunk_id", "path", "chunk_index", "heading", "heading_path_json", "content"}
    ),
    "db_meta": frozenset({"key", "value"}),
    "note_tags": frozenset({"path", "tag"}),
    "notes": frozenset({"path", "title", "summary"}),
}
OPTIONAL_TABLE_COLUMNS = {
    "note_keywords": frozenset({"path", "keyword"}),
}
VECTOR_REQUIRED_COLUMNS = {
    "chunk_rowids": frozenset({"chunk_id", "rowid"}),
}


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
            tables = load_available_tables(conn)
            columns_by_table = load_table_columns(
                conn,
                frozenset(
                    {
                        *BASE_REQUIRED_COLUMNS,
                        *VECTOR_REQUIRED_COLUMNS,
                        *(table for table in OPTIONAL_TABLE_COLUMNS if table in tables),
                    }
                ),
            )
    except sqlite3.Error:
        return IndexStatus(
            db_path=db_path,
            db_configured=True,
            index_db_exists=True,
            index_schema_ready=False,
            vector_index_ready=False,
        )

    index_schema_ready = (
        BASE_REQUIRED_TABLES.issubset(tables)
        and has_required_columns(columns_by_table, BASE_REQUIRED_COLUMNS)
        and has_optional_table_columns(tables, columns_by_table, OPTIONAL_TABLE_COLUMNS)
    )
    vector_index_ready = (
        index_schema_ready
        and VECTOR_REQUIRED_TABLES.issubset(tables)
        and has_required_columns(columns_by_table, VECTOR_REQUIRED_COLUMNS)
    )

    return IndexStatus(
        db_path=db_path,
        db_configured=True,
        index_db_exists=True,
        index_schema_ready=index_schema_ready,
        vector_index_ready=vector_index_ready,
        available_tables=tables,
    )


def ensure_index_ready(index_status: IndexStatus) -> None:
    if index_status.db_path is None:
        raise IndexNotReadyError(
            "Index DB is not configured. Set AILSS_DB_PATH or AILSS_VAULT_PATH."
        )
    if not index_status.index_db_exists:
        raise IndexNotReadyError(f"Index DB does not exist: {index_status.db_path}")
    if not index_status.index_schema_ready:
        raise IndexNotReadyError(f"Index DB schema is incomplete: {index_status.db_path}")


def connect_db(db_path: Path | None, *, load_vector_extension: bool) -> sqlite3.Connection:
    if db_path is None:
        raise IndexNotReadyError("Index DB path is not configured.")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    if load_vector_extension:
        try:
            conn.enable_load_extension(True)
            sqlite_vec.load(conn)
            conn.enable_load_extension(False)
        except Exception as error:
            with suppress(sqlite3.Error):
                conn.enable_load_extension(False)
            conn.close()
            raise IndexNotReadyError(
                "sqlite-vec extension could not be loaded. "
                "Verify the sqlite-vec dependency for this host."
            ) from error
    return conn


def load_available_tables(conn: sqlite3.Connection) -> frozenset[str]:
    return frozenset(
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
        ).fetchall()
    )


def load_table_columns(
    conn: sqlite3.Connection, tables: frozenset[str]
) -> dict[str, frozenset[str]]:
    columns_by_table: dict[str, frozenset[str]] = {}
    for table in tables:
        quoted_table = table.replace('"', '""')
        columns_by_table[table] = frozenset(
            str(row[1]) for row in conn.execute(f'PRAGMA table_info("{quoted_table}")').fetchall()
        )
    return columns_by_table


def has_required_columns(
    columns_by_table: dict[str, frozenset[str]],
    required_columns: dict[str, frozenset[str]],
) -> bool:
    return all(
        columns.issubset(columns_by_table.get(table, frozenset()))
        for table, columns in required_columns.items()
    )


def has_optional_table_columns(
    tables: frozenset[str],
    columns_by_table: dict[str, frozenset[str]],
    optional_columns: dict[str, frozenset[str]],
) -> bool:
    return all(
        columns.issubset(columns_by_table.get(table, frozenset()))
        for table, columns in optional_columns.items()
        if table in tables
    )


def ensure_embedding_config_matches(
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
