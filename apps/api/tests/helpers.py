from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import sqlite_vec  # type: ignore[import-untyped]
from openai import OpenAIError
from pytest import MonkeyPatch

from ailss_api.config import Settings
from ailss_api.embeddings import EmbedQueryResult

DEFAULT_RETRIEVE_QUERY = "python backend"
DEFAULT_AGENT_INPUT = "Summarize the Python-first backend direction for this repo."
DEFAULT_EXPECTED_PATHS = ["docs/03-plan.md"]
DEFAULT_EXPECTED_TERMS = ["python-first", "backend"]


def build_settings_with_seed_data(tmp_path: Path) -> Settings:
    vault_path = tmp_path / "vault"
    docs_dir = vault_path / "docs"
    docs_dir.mkdir(parents=True)
    (vault_path / ".ailss").mkdir(parents=True)
    (docs_dir / "03-plan.md").write_text(
        "# Plan\n\nPython-first backend direction for AILSS.\n",
        encoding="utf-8",
    )

    db_path = tmp_path / "index.sqlite"
    seed_index_db(db_path)
    dataset_dir = tmp_path / "datasets"
    dataset_dir.mkdir()

    return Settings(
        vault_path=vault_path,
        db_path=db_path,
        eval_artifact_dir=tmp_path / "eval-artifacts",
        dataset_dir=dataset_dir,
        run_artifact_dir=tmp_path / "run-artifacts",
        openai_api_key="sk-test",
        openai_embedding_model="test-embeddings",
    )


def seed_index_db(db_path: Path) -> None:
    with closing(sqlite3.connect(db_path)) as conn:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        conn.executescript(
            """
            CREATE TABLE db_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE notes (
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
              updated_at TEXT NOT NULL
            );
            CREATE TABLE note_tags (
              path TEXT NOT NULL,
              tag TEXT NOT NULL,
              PRIMARY KEY(path, tag)
            );
            CREATE TABLE note_keywords (
              path TEXT NOT NULL,
              keyword TEXT NOT NULL,
              PRIMARY KEY(path, keyword)
            );
            CREATE TABLE chunks (
              chunk_id TEXT PRIMARY KEY,
              path TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              heading TEXT,
              heading_path_json TEXT NOT NULL,
              content TEXT NOT NULL,
              content_sha256 TEXT NOT NULL,
              embedding_input_sha256 TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE chunk_rowids (
              chunk_id TEXT PRIMARY KEY,
              rowid INTEGER UNIQUE NOT NULL
            );
            CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
              embedding FLOAT[3]
            );
            """
        )
        conn.executemany(
            "INSERT INTO db_meta(key, value, updated_at) VALUES (?, ?, ?)",
            [
                ("embedding_model", "test-embeddings", "2026-03-15T00:00:00"),
                ("embedding_dim", "3", "2026-03-15T00:00:00"),
            ],
        )
        conn.executemany(
            """
            INSERT INTO notes(
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
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "docs/03-plan.md",
                    "20260315000000",
                    "2026-03-15",
                    "Python-first backend baseline",
                    "Move AILSS toward a Python-first local backend with retrieval and evaluation.",
                    "doc",
                    "architecture",
                    "draft",
                    "2026-03-15",
                    "{}",
                    "2026-03-15T00:00:00",
                ),
                (
                    "notes/random.md",
                    "20260315000001",
                    "2026-03-15",
                    "Random note",
                    "Unrelated content.",
                    "note",
                    "misc",
                    "draft",
                    "2026-03-15",
                    "{}",
                    "2026-03-15T00:00:00",
                ),
            ],
        )
        conn.executemany(
            "INSERT INTO note_tags(path, tag) VALUES (?, ?)",
            [
                ("docs/03-plan.md", "architecture"),
                ("docs/03-plan.md", "project"),
                ("notes/random.md", "misc"),
            ],
        )
        conn.executemany(
            "INSERT INTO note_keywords(path, keyword) VALUES (?, ?)",
            [
                ("docs/03-plan.md", "python-first"),
                ("docs/03-plan.md", "backend"),
            ],
        )
        conn.executemany(
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "docs-03-plan-0",
                    "docs/03-plan.md",
                    0,
                    "Plan",
                    '["Plan"]',
                    (
                        "Python-first backend direction for AILSS with local retrieval, "
                        "agent orchestration, and evaluation."
                    ),
                    "sha1",
                    "embed1",
                    "2026-03-15T00:00:00",
                ),
                (
                    "notes-random-0",
                    "notes/random.md",
                    0,
                    "Random",
                    '["Random"]',
                    "A disconnected note with no backend details.",
                    "sha2",
                    "embed2",
                    "2026-03-15T00:00:00",
                ),
            ],
        )
        conn.executemany(
            "INSERT INTO chunk_rowids(chunk_id, rowid) VALUES (?, ?)",
            [
                ("docs-03-plan-0", 1),
                ("notes-random-0", 2),
            ],
        )
        conn.executemany(
            "INSERT INTO chunk_embeddings(rowid, embedding) VALUES (?, ?)",
            [
                (1, "[0.1, 0.2, 0.3]"),
                (2, "[0.9, 0.1, 0.0]"),
            ],
        )
        conn.commit()


def drop_chunk_index_column(db_path: Path) -> None:
    with closing(sqlite3.connect(db_path)) as conn:
        conn.executescript(
            """
            DROP TABLE chunks;
            CREATE TABLE chunks (
              chunk_id TEXT PRIMARY KEY,
              path TEXT NOT NULL,
              heading TEXT,
              heading_path_json TEXT NOT NULL,
              content TEXT NOT NULL,
              content_sha256 TEXT NOT NULL,
              embedding_input_sha256 TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        conn.commit()


def set_db_meta_value(db_path: Path, key: str, value: str) -> None:
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute("UPDATE db_meta SET value = ? WHERE key = ?", (value, key))
        conn.commit()


def insert_lexical_note(
    db_path: Path,
    *,
    path: str,
    title: str | None,
    summary: str | None,
    chunks: list[str],
    tags: list[str] | None = None,
) -> None:
    note_id = path.replace("/", "-").replace(".", "-")
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute(
            """
            INSERT INTO notes(
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
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                path,
                note_id,
                "2026-03-15",
                title,
                summary,
                "note",
                "test",
                "draft",
                "2026-03-15",
                "{}",
                "2026-03-15T00:00:00",
            ),
        )
        if tags:
            conn.executemany(
                "INSERT INTO note_tags(path, tag) VALUES (?, ?)",
                [(path, tag) for tag in tags],
            )
        conn.executemany(
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    f"{note_id}-{index}",
                    path,
                    index,
                    "Section",
                    '["Section"]',
                    content,
                    f"sha-{note_id}-{index}",
                    f"embed-{note_id}-{index}",
                    "2026-03-15T00:00:00",
                )
                for index, content in enumerate(chunks)
            ],
        )
        conn.commit()


def fake_embedding_result(vector: list[float] | None = None) -> EmbedQueryResult:
    return EmbedQueryResult(
        vector=vector or [0.1, 0.2, 0.25],
        model="test-embeddings",
        prompt_tokens=7,
    )


def set_fake_embedding(monkeypatch: MonkeyPatch, vector: list[float] | None = None) -> None:
    monkeypatch.setattr(
        "ailss_api.retrieval.embed_query",
        lambda settings, text: fake_embedding_result(vector),
    )


def raise_openai_error(settings: Settings, text: str) -> EmbedQueryResult:
    raise OpenAIError("embedding boom")


def raise_sqlite_vec_load_error(conn: sqlite3.Connection) -> None:
    raise sqlite3.OperationalError("sqlite-vec boom")


def build_eval_case(
    case_id: str,
    *,
    input_text: str = DEFAULT_AGENT_INPUT,
    path_prefix: str = "docs/",
    top_k: int = 2,
    expected_paths: list[str] | None = None,
    expected_terms: list[str] | None = None,
) -> dict[str, object]:
    return {
        "case_id": case_id,
        "input": input_text,
        "context": {"path_prefix": path_prefix, "top_k": top_k},
        "expected_paths": expected_paths or DEFAULT_EXPECTED_PATHS,
        "expected_terms": expected_terms or DEFAULT_EXPECTED_TERMS,
    }


def write_eval_dataset(
    settings: Settings,
    cases: list[dict[str, object]],
    *,
    dataset_id: str = "golden-local-baseline",
) -> Path:
    dataset_path = settings.resolved_dataset_dir / f"{dataset_id}.json"
    dataset_path.write_text(json.dumps(cases), encoding="utf-8")
    return dataset_path
