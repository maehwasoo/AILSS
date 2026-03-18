from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ailss_api.config import Settings
from ailss_api.main import create_app
from tests.helpers import build_settings_with_seed_data, drop_chunk_index_column, seed_index_db


def test_health_reports_ready_index(tmp_path: Path) -> None:
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    (vault_path / ".ailss").mkdir()
    db_path = tmp_path / "index.sqlite"
    seed_index_db(db_path)

    settings = Settings(
        vault_path=vault_path,
        db_path=db_path,
        dataset_dir=tmp_path / "datasets",
        openai_api_key="sk-test",
        openai_embedding_model="test-embeddings",
    )
    settings.resolved_dataset_dir.mkdir(parents=True, exist_ok=True)

    client = TestClient(create_app(settings))
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["checks"]["index_schema_ready"] is True
    assert payload["checks"]["vector_index_ready"] is True


def test_health_reports_degraded_when_required_index_columns_are_missing(
    tmp_path: Path,
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    assert settings.resolved_db_path is not None
    drop_chunk_index_column(settings.resolved_db_path)

    client = TestClient(create_app(settings))
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["checks"]["index_schema_ready"] is False
    assert payload["checks"]["vector_index_ready"] is False
