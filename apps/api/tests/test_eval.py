from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ailss_api.main import create_app
from tests.helpers import (
    build_eval_case,
    build_settings_with_seed_data,
    raise_openai_error,
    set_fake_embedding,
    write_eval_dataset,
)


def test_eval_run_writes_artifacts(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    write_eval_dataset(settings, [build_eval_case("python-first-transition")])

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["cases_total"] == 1
    assert payload["summary"]["cases_passed"] == 1
    assert payload["summary"]["embedding_prompt_tokens_total"] == 7
    artifact_dir = Path(payload["artifact_dir"])
    assert (artifact_dir / "summary.json").exists()
    assert (artifact_dir / "cases.json").exists()


def test_eval_run_falls_back_when_note_excerpt_read_fails(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    assert settings.resolved_vault_path is not None
    note_path = settings.resolved_vault_path / "docs" / "03-plan.md"
    note_path.write_bytes(b"\xff\xfeinvalid-utf8")
    write_eval_dataset(settings, [build_eval_case("python-first-transition-read-failure")])

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["cases_total"] == 1
    assert payload["summary"]["cases_passed"] == 1


def test_eval_run_surfaces_embedding_provider_failures(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    write_eval_dataset(settings, [build_eval_case("python-first-transition")])
    monkeypatch.setattr("ailss_api.retrieval.embed_query", raise_openai_error)

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 503
    assert (
        response.json()["detail"] == "Semantic retrieval embedding request failed: embedding boom"
    )


def test_eval_run_clamps_agent_top_k_to_agent_limit(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    write_eval_dataset(
        settings,
        [build_eval_case("python-first-transition-high-top-k", top_k=20)],
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["cases_total"] == 1
    assert payload["summary"]["cases_passed"] == 1


def test_eval_run_rejects_invalid_dataset_top_k(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    write_eval_dataset(
        settings,
        [build_eval_case("python-first-invalid-top-k", top_k=50)],
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Eval dataset case python-first-invalid-top-k has invalid context.top_k=50. Expected 1..20."
    )


def test_eval_run_rejects_non_array_dataset_payload(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    dataset_path = settings.resolved_dataset_dir / "golden-local-baseline.json"
    dataset_path.write_text(
        json.dumps({"case_id": "python-first-transition"}),
        encoding="utf-8",
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 400
    assert response.json()["detail"] == f"Eval dataset must be a JSON array: {dataset_path}"


def test_eval_run_rejects_unreadable_dataset_file(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    dataset_path = settings.resolved_dataset_dir / "golden-local-baseline.json"
    dataset_path.write_bytes(b"\xff\xfeinvalid-utf8")

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 400
    assert (
        response.json()["detail"] == f"Eval dataset could not be read as UTF-8 text: {dataset_path}"
    )


def test_eval_run_rejects_invalid_dataset_entry_shape(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    dataset_path = settings.resolved_dataset_dir / "golden-local-baseline.json"
    dataset_path.write_text(
        json.dumps(
            [
                {
                    "case_id": "python-first-missing-input",
                    "context": {"path_prefix": "docs/", "top_k": 2},
                    "expected_paths": ["docs/03-plan.md"],
                    "expected_terms": ["python-first", "backend"],
                }
            ]
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Eval dataset entry 0 failed validation: input: Field required"
    )


def test_eval_run_rejects_blank_dataset_input(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    write_eval_dataset(
        settings,
        [build_eval_case("python-first-blank-input", input_text="   ")],
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "golden-local-baseline", "limit": 5})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail.startswith("Eval dataset entry 0 failed validation: input:")
    assert "at least 1 character" in detail


def test_eval_run_rejects_dataset_path_traversal(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    outside_dataset = tmp_path / "escaped.json"
    outside_dataset.write_text(
        json.dumps(
            [
                {
                    "case_id": "escaped-dataset",
                    "input": "Should not load this dataset.",
                }
            ]
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(settings))
    response = client.post("/eval/run", json={"dataset_id": "../escaped", "limit": 5})

    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Eval dataset_id must stay within the configured dataset_dir."
    )
