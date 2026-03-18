from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ailss_api.main import create_app
from tests.helpers import (
    DEFAULT_RETRIEVE_QUERY,
    build_settings_with_seed_data,
    drop_chunk_index_column,
    raise_openai_error,
    raise_sqlite_vec_load_error,
    set_db_meta_value,
    set_fake_embedding,
)


def test_retrieve_returns_semantic_matches(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
            "path_prefix": "docs/",
            "tags_any": ["architecture"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "semantic_local"
    assert payload["results"][0]["path"] == "docs/03-plan.md"
    assert payload["results"][0]["evidence"][0]["chunk_id"] == "docs-03-plan-0"
    assert payload["usage"]["embedding_prompt_tokens"] == 7


def test_retrieve_rejects_incomplete_index_schema_before_query_execution(
    tmp_path: Path,
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    assert settings.resolved_db_path is not None
    drop_chunk_index_column(settings.resolved_db_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
        },
    )

    assert response.status_code == 503
    assert (
        response.json()["detail"] == f"Index DB schema is incomplete: {settings.resolved_db_path}"
    )


def test_retrieve_supports_explicit_lexical_mode(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "mode": "lexical",
            "top_k": 2,
            "path_prefix": "docs/",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "lexical_baseline"
    assert payload["results"][0]["path"] == "docs/03-plan.md"


def test_retrieve_surfaces_embedding_provider_failures(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    monkeypatch.setattr("ailss_api.retrieval.embed_query", raise_openai_error)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
        },
    )

    assert response.status_code == 503
    assert (
        response.json()["detail"] == "Semantic retrieval embedding request failed: embedding boom"
    )


def test_retrieve_surfaces_sqlite_vec_load_failures(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    monkeypatch.setattr("ailss_api.retrieval_index.sqlite_vec.load", raise_sqlite_vec_load_error)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "sqlite-vec extension could not be loaded. Verify the sqlite-vec dependency for this host."
    )


def test_retrieve_rejects_invalid_embedding_dim_metadata(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    assert settings.resolved_db_path is not None
    set_db_meta_value(settings.resolved_db_path, "embedding_dim", "not-a-number")
    set_fake_embedding(monkeypatch)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Embedding dimension metadata in the local DB is invalid. "
        "DB has embedding_dim='not-a-number'."
    )


def test_retrieve_omits_preview_when_file_read_fails(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    assert settings.resolved_vault_path is not None
    note_path = settings.resolved_vault_path / "docs" / "03-plan.md"
    note_path.write_bytes(b"\xff\xfeinvalid-utf8")
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
            "path_prefix": "docs/",
            "include_file_preview": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"][0]["path"] == "docs/03-plan.md"
    assert payload["results"][0]["preview"] is None
    assert payload["results"][0]["preview_truncated"] is False


def test_retrieve_rejects_blank_query_in_lexical_mode(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": "   ",
            "mode": "lexical",
        },
    )

    assert response.status_code == 422
