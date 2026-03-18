from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ailss_api.main import create_app
from tests.helpers import build_settings_with_seed_data


def test_shutdown_requires_valid_token(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    settings.shutdown_token = "shutdown-token"
    client = TestClient(create_app(settings))

    response = client.post("/__ailss/shutdown")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid shutdown token."


def test_shutdown_succeeds_with_valid_token(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    settings.shutdown_token = "shutdown-token"
    terminated: list[str] = []
    monkeypatch.setattr(
        "ailss_api.main._terminate_current_process",
        lambda: terminated.append("called"),
    )
    client = TestClient(create_app(settings))

    response = client.post(
        "/__ailss/shutdown",
        headers={"Authorization": "Bearer shutdown-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert terminated == ["called"]
