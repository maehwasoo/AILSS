from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from ailss_api.main import create_app
from ailss_api.models import FailureCode
from tests.helpers import (
    DEFAULT_AGENT_INPUT,
    DEFAULT_RETRIEVE_QUERY,
    build_settings_with_seed_data,
    set_fake_embedding,
)

PARITY_DOC_PATH = (
    Path(__file__).resolve().parents[3] / "docs" / "architecture" / "python-mcp-parity.md"
)


def _extract_bulleted_code_items(markdown: str, heading: str) -> list[str]:
    lines = markdown.splitlines()
    heading_index = next(
        (index for index, line in enumerate(lines) if line.strip() == heading),
        -1,
    )
    if heading_index < 0:
        return []

    values: list[str] = []
    for line in lines[heading_index + 1 :]:
        stripped = line.strip()
        if not stripped:
            if values:
                break
            continue
        if stripped.startswith("#"):
            break

        match = re.match(r"^- `([^`]+)`$", stripped)
        if match is None:
            continue
        values.append(match.group(1))
    return values


def test_parity_doc_lists_current_agent_failure_codes() -> None:
    doc = PARITY_DOC_PATH.read_text(encoding="utf-8")

    documented = sorted(
        _extract_bulleted_code_items(
            doc,
            "## Required failure codes for Python-covered agent flows",
        )
    )
    actual = sorted(get_args(FailureCode))

    assert documented == actual


def test_retrieve_parity_respects_combined_scope_filters(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    client = TestClient(create_app(settings))

    response = client.post(
        "/retrieve",
        json={
            "query": DEFAULT_RETRIEVE_QUERY,
            "top_k": 3,
            "path_prefix": "docs/",
            "tags_any": ["project"],
            "tags_all": ["architecture", "project"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [result["path"] for result in payload["results"]] == ["docs/03-plan.md"]
    assert set(payload["results"][0]["tags"]) == {"architecture", "project"}


def test_agent_run_returns_missing_context_when_scoped_filters_remove_candidates(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    set_fake_embedding(monkeypatch)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": DEFAULT_AGENT_INPUT,
            "context": {
                "path_prefix": "notes/",
                "tags_all": ["architecture"],
                "top_k": 1,
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "failed"
    assert payload["failure"]["code"] == "missing_context"


def test_agent_run_rejects_write_request_with_apply_true(tmp_path: Path) -> None:
    settings = build_settings_with_seed_data(tmp_path)
    client = TestClient(create_app(settings))

    response = client.post(
        "/agent/run",
        json={
            "input": "Write the summary into a new note.",
            "requested_write_action": "capture_note",
            "apply": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["outcome"] == "failed"
    assert payload["failure"]["code"] == "write_not_allowed"
    assert payload["write_actions"] == [
        {
            "action": "capture_note",
            "allowed": False,
            "reason": "write_not_allowed",
        }
    ]
