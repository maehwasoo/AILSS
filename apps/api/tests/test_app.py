from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from ailss_api.config import Settings
from ailss_api.main import create_app


def test_health_reports_ready_index(tmp_path: Path) -> None:
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    db_path = tmp_path / "index.sqlite"
    _seed_index_db(db_path)

    settings = Settings(
        vault_path=vault_path,
        db_path=db_path,
        dataset_dir=tmp_path / "datasets",
    )
    settings.resolved_dataset_dir.mkdir(parents=True, exist_ok=True)

    client = TestClient(create_app(settings))
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["checks"]["index_schema_ready"] is True


def test_retrieve_returns_ranked_matches(tmp_path: Path) -> None:
    settings = _build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": "python backend",
            "top_k": 3,
            "path_prefix": "docs/",
            "tags_any": ["architecture"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "lexical_baseline"
    assert payload["results"][0]["path"] == "docs/03-plan.md"
    assert payload["results"][0]["evidence"][0]["chunk_id"] == "docs-03-plan-0"


def test_agent_run_returns_grounded_answer(tmp_path: Path) -> None:
    settings = _build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": "Summarize the Python-first backend direction for this repo.",
            "context": {"path_prefix": "docs/", "top_k": 2},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "completed"
    assert payload["citations"][0]["path"] == "docs/03-plan.md"
    assert payload["workflow"][-1]["name"] == "validate"
    assert "python-first" in payload["answer"].lower()


def test_agent_run_rejects_write_request_without_apply(tmp_path: Path) -> None:
    settings = _build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": "Write the summary into a new note.",
            "requested_write_action": "capture_note",
            "apply": False,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "failed"
    assert payload["failure"]["code"] == "apply_not_requested"


def test_eval_run_writes_artifacts(tmp_path: Path) -> None:
    settings = _build_settings_with_seed_data(tmp_path)
    dataset_path = settings.resolved_dataset_dir / "golden-local-baseline.json"
    dataset_path.write_text(
        json.dumps(
            [
                {
                    "case_id": "python-first-transition",
                    "input": "Summarize the Python-first backend direction for this repo.",
                    "context": {"path_prefix": "docs/", "top_k": 2},
                    "expected_paths": ["docs/03-plan.md"],
                    "expected_terms": ["python-first", "backend"],
                }
            ],
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["cases_total"] == 1
    assert payload["summary"]["cases_passed"] == 1
    artifact_dir = Path(payload["artifact_dir"])
    assert (artifact_dir / "summary.json").exists()
    assert (artifact_dir / "cases.json").exists()


def _build_settings_with_seed_data(tmp_path: Path) -> Settings:
    vault_path = tmp_path / "vault"
    docs_dir = vault_path / "docs"
    docs_dir.mkdir(parents=True)
    (docs_dir / "03-plan.md").write_text(
        "# Plan\n\nPython-first backend direction for AILSS.\n",
        encoding="utf-8",
    )

    db_path = tmp_path / "index.sqlite"
    _seed_index_db(db_path)
    dataset_dir = tmp_path / "datasets"
    dataset_dir.mkdir()

    return Settings(
        vault_path=vault_path,
        db_path=db_path,
        eval_artifact_dir=tmp_path / "eval-artifacts",
        dataset_dir=dataset_dir,
    )


def _seed_index_db(db_path: Path) -> None:
    with closing(sqlite3.connect(db_path)) as conn:
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
                ("notes/random.md", "misc"),
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
        conn.commit()
