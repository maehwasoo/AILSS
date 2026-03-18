from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ailss_api.main import create_app
from ailss_api.models import EvidenceChunk, RetrievalUsage, RetrieveResponse, RetrieveResult
from tests.helpers import (
    DEFAULT_AGENT_INPUT,
    build_settings_with_seed_data,
    raise_openai_error,
    set_fake_embedding,
)


def test_agent_run_returns_grounded_answer(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": DEFAULT_AGENT_INPUT,
            "context": {"path_prefix": "docs/", "top_k": 2},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "completed"
    assert payload["citations"][0]["path"] == "docs/03-plan.md"
    assert payload["workflow"][-1]["name"] == "validate"
    assert payload["metrics"]["retrieval_mode"] == "semantic_local"
    assert payload["artifact_path"].endswith(".json")
    assert "python-first" in payload["answer"].lower()


def test_agent_run_surfaces_embedding_provider_failures(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    monkeypatch.setattr("ailss_api.retrieval.embed_query", raise_openai_error)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": DEFAULT_AGENT_INPUT,
            "context": {"path_prefix": "docs/", "top_k": 2},
        },
    )

    assert response.status_code == 503
    assert (
        response.json()["detail"] == "Semantic retrieval embedding request failed: embedding boom"
    )


def test_agent_run_rejects_blank_input(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": "   ",
        },
    )

    assert response.status_code == 422


def test_agent_run_does_not_read_outside_vault(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    outside_file = tmp_path / "secret.txt"
    outside_file.write_text("TOP SECRET", encoding="utf-8")
    monkeypatch.setattr(
        "ailss_api.agent.retrieve_notes",
        lambda request, settings: RetrieveResponse(
            query=request.query,
            mode="semantic_local",
            results=[
                RetrieveResult(
                    path="../secret.txt",
                    title="Escaped note",
                    summary="Tampered path outside the vault.",
                    snippet="Safe indexed content that should remain grounded.",
                    evidence_text="Safe indexed content that should remain grounded.",
                    evidence=[
                        EvidenceChunk(
                            chunk_id="escaped-0",
                            text="Safe indexed content that should remain grounded.",
                        )
                    ],
                )
            ],
            usage=RetrievalUsage(latency_ms=1.0, used_chunks_k=1),
        ),
    )
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": "Summarize the escaped note.",
            "context": {"top_k": 1},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "completed"
    assert "TOP SECRET" not in (payload["answer"] or "")
    assert payload["citations"][0]["path"] == "../secret.txt"


def test_agent_run_falls_back_when_note_excerpt_read_fails(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    assert settings.resolved_vault_path is not None
    note_path = settings.resolved_vault_path / "docs" / "03-plan.md"
    note_path.write_bytes(b"\xff\xfeinvalid-utf8")
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": DEFAULT_AGENT_INPUT,
            "context": {"path_prefix": "docs/", "top_k": 2},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "completed"
    assert "python-first" in payload["answer"].lower()


def test_agent_run_cites_hit_chunk_when_neighbors_precede_match(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    monkeypatch.setattr(
        "ailss_api.agent.retrieve_notes",
        lambda request, settings: RetrieveResponse(
            query=request.query,
            mode="semantic_local",
            results=[
                RetrieveResult(
                    path="docs/03-plan.md",
                    title="Python-first backend baseline",
                    summary=(
                        "Move AILSS toward a Python-first local backend with retrieval and "
                        "evaluation."
                    ),
                    snippet="Python-first backend direction for AILSS.",
                    evidence_text="Matched evidence text.",
                    evidence=[
                        EvidenceChunk(
                            chunk_id="docs-03-plan-0",
                            chunk_index=0,
                            kind="neighbor",
                            text="Neighbor evidence text.",
                        ),
                        EvidenceChunk(
                            chunk_id="docs-03-plan-1",
                            chunk_index=1,
                            kind="hit",
                            text="Matched evidence text.",
                        ),
                    ],
                )
            ],
            usage=RetrievalUsage(latency_ms=1.0, used_chunks_k=1),
        ),
    )
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": DEFAULT_AGENT_INPUT,
            "context": {"top_k": 1, "neighbor_window": 1},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "completed"
    assert payload["citations"][0]["chunk_id"] == "docs-03-plan-1"


def test_agent_run_rejects_write_request_without_apply(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
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
