from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from mcp.server.fastmcp import FastMCP
from openai import OpenAI
from pytest import MonkeyPatch

from ailss_api.config import Settings
from ailss_api.embeddings import EmbedQueryResult
from ailss_api.index_db import OpenIndexDbOptions, embedding_dim_for_model, open_index_db
from ailss_api.indexer_runtime import IndexVaultOptions, index_vault
from ailss_api.mcp_runtime import McpRuntime, register_mcp_tools
from ailss_api.tool_failure_diagnostics import ToolFailureDiagnostics
from ailss_api.vault_runtime import build_ailss_frontmatter, render_markdown_with_frontmatter

EMBEDDING_MODEL = "test-embeddings"
EMBEDDING_DIM = embedding_dim_for_model(EMBEDDING_MODEL)
READ_TOOL_NAMES = {
    "expand_typed_links_outgoing",
    "find_broken_links",
    "find_typed_links_incoming",
    "frontmatter_validate",
    "get_context",
    "get_tool_failure_report",
    "get_vault_tree",
    "list_keywords",
    "list_tags",
    "list_typed_link_rels",
    "read_note",
    "resolve_note",
    "search_notes",
}
WRITE_TOOL_NAMES = {
    "canonicalize_typed_links",
    "capture_note",
    "edit_note",
    "improve_frontmatter",
    "relocate_note",
}


@dataclass(frozen=True)
class _FakeEmbeddingRecord:
    embedding: list[float]


@dataclass(frozen=True)
class _FakeEmbeddingResponse:
    data: list[_FakeEmbeddingRecord]


class _FakeEmbeddingsEndpoint:
    def create(
        self,
        *,
        model: str,
        input: list[str],
        encoding_format: str,
    ) -> _FakeEmbeddingResponse:
        assert model == EMBEDDING_MODEL
        assert encoding_format == "float"
        return _FakeEmbeddingResponse(
            data=[_FakeEmbeddingRecord(_vector_for_text(item)) for item in input]
        )


class _FakeOpenAIClient:
    def __init__(self) -> None:
        self.embeddings = _FakeEmbeddingsEndpoint()


@dataclass
class RuntimeHarness:
    conn: sqlite3.Connection
    server: FastMCP
    vault_path: Path

    def close(self) -> None:
        self.conn.close()


def _vector_for_text(text: str) -> list[float]:
    lower = text.lower()
    vector = [0.0] * EMBEDDING_DIM
    if "child" in lower:
        vector[0] += 3.0
    if "depends" in lower or "dependency" in lower:
        vector[0] += 2.0
        vector[1] += 1.0
    if "parent" in lower:
        vector[1] += 2.0
    if "broken" in lower or "missing" in lower:
        vector[2] += 3.0
    if "fresh capture" in lower:
        vector[3] += 4.0
    if "legacy" in lower:
        vector[4] += 2.0
    if not any(vector):
        vector[-1] = 1.0
    return vector


def _set_fake_retrieval_embedding(monkeypatch: MonkeyPatch) -> None:
    def fake_embed_query(settings: Settings, text: str) -> EmbedQueryResult:
        del settings
        return EmbedQueryResult(
            vector=_vector_for_text(text),
            model=EMBEDDING_MODEL,
            prompt_tokens=5,
        )

    monkeypatch.setattr("ailss_api.retrieval.embed_query", fake_embed_query)


def _write_note(
    vault_path: Path,
    rel_path: str,
    *,
    title: str,
    body: str,
    now: str,
    overrides: dict[str, object] | None = None,
) -> None:
    frontmatter = build_ailss_frontmatter(title=title, now=now, overrides=overrides)
    content = render_markdown_with_frontmatter(frontmatter=frontmatter, body=body)
    abs_path = vault_path / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")


def _build_runtime_harness(
    tmp_path: Path,
    monkeypatch: MonkeyPatch,
    *,
    enable_write_tools: bool,
) -> RuntimeHarness:
    _set_fake_retrieval_embedding(monkeypatch)
    vault_path = tmp_path / "vault"
    db_path = tmp_path / "index.sqlite"
    vault_path.mkdir(parents=True)

    _write_note(
        vault_path,
        "docs/Child.md",
        title="Child",
        body="# Child\n\nChild dependency target.\n",
        now="2026-03-19T12:00:01",
        overrides={"entity": "software", "layer": "logical", "tags": ["project"]},
    )
    _write_note(
        vault_path,
        "docs/Parent.md",
        title="Parent",
        body="# Parent\n\nParent depends on Child for dependency resolution.\n",
        now="2026-03-19T12:00:02",
        overrides={
            "entity": "software",
            "layer": "logical",
            "tags": ["project"],
            "depends_on": ["[[Child]]"],
        },
    )
    _write_note(
        vault_path,
        "docs/Broken.md",
        title="Broken",
        body="# Broken\n\nBroken note references a missing target.\n",
        now="2026-03-19T12:00:03",
        overrides={
            "entity": "software",
            "layer": "logical",
            "tags": ["project"],
            "depends_on": ["[[Missing]]"],
        },
    )
    scratch_path = vault_path / "scratch" / "NoFrontmatter.md"
    scratch_path.parent.mkdir(parents=True, exist_ok=True)
    scratch_path.write_text("# Legacy\n\nLegacy note without frontmatter.\n", encoding="utf-8")

    settings = Settings(
        vault_path=vault_path,
        db_path=db_path,
        openai_api_key="sk-test",
        openai_embedding_model=EMBEDDING_MODEL,
    )
    conn = open_index_db(
        OpenIndexDbOptions(
            db_path=db_path,
            embedding_model=EMBEDDING_MODEL,
            embedding_dim=EMBEDDING_DIM,
        )
    )
    index_vault(
        IndexVaultOptions(
            conn=conn,
            db_path_for_log=str(db_path),
            vault_path=vault_path,
            openai=cast(OpenAI, _FakeOpenAIClient()),
            embedding_model=EMBEDDING_MODEL,
        )
    )

    runtime = McpRuntime(
        settings=settings,
        conn=conn,
        openai_client=cast(OpenAI, _FakeOpenAIClient()),
        diagnostics=ToolFailureDiagnostics(vault_path=vault_path, cwd=tmp_path),
        enable_write_tools=enable_write_tools,
        default_top_k=5,
        shutdown_token="shutdown-token",
    )
    server = FastMCP(name="ailss-test")
    register_mcp_tools(server, runtime)
    return RuntimeHarness(conn=conn, server=server, vault_path=vault_path)


def _tool_names(server: FastMCP) -> set[str]:
    manager = cast(Any, server)._tool_manager
    return {str(tool.name) for tool in manager.list_tools()}


def _call_tool(server: FastMCP, name: str, /, **kwargs: object) -> dict[str, object]:
    manager = cast(Any, server)._tool_manager
    tool = manager.get_tool(name)
    return cast(dict[str, object], tool.fn(**kwargs))


def test_mcp_runtime_registers_full_python_surface(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    read_only = _build_runtime_harness(tmp_path / "read", monkeypatch, enable_write_tools=False)
    writable = _build_runtime_harness(tmp_path / "write", monkeypatch, enable_write_tools=True)
    try:
        assert _tool_names(read_only.server) == READ_TOOL_NAMES
        assert _tool_names(writable.server) == READ_TOOL_NAMES | WRITE_TOOL_NAMES
    finally:
        read_only.close()
        writable.close()


def test_open_index_db_creates_missing_parent_directory(tmp_path: Path) -> None:
    db_path = tmp_path / "vault" / ".ailss" / "index.sqlite"

    assert not db_path.parent.exists()

    conn = open_index_db(
        OpenIndexDbOptions(
            db_path=db_path,
            embedding_model=EMBEDDING_MODEL,
            embedding_dim=EMBEDDING_DIM,
        )
    )
    try:
        assert db_path.parent.is_dir()
        assert db_path.exists()
    finally:
        conn.close()


def test_mcp_runtime_read_tools_use_python_index_and_vault(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    harness = _build_runtime_harness(tmp_path, monkeypatch, enable_write_tools=False)
    try:
        resolved = _call_tool(harness.server, "resolve_note", query="Child")
        best = cast(dict[str, object], resolved["best"])
        assert resolved["status"] == "ok"
        assert best["path"] == "docs/Child.md"

        rels = _call_tool(harness.server, "list_typed_link_rels", path_prefix="docs/")
        rel_items = cast(list[dict[str, object]], rels["rels"])
        assert any(item["rel"] == "depends_on" and item["count"] == 2 for item in rel_items)

        incoming = _call_tool(
            harness.server,
            "find_typed_links_incoming",
            rel="depends_on",
            to_target="Child",
        )
        backrefs = cast(list[dict[str, object]], incoming["backrefs"])
        assert [item["from_path"] for item in backrefs] == ["docs/Parent.md"]

        broken = _call_tool(harness.server, "find_broken_links", path_prefix="docs/")
        broken_items = cast(list[dict[str, object]], broken["broken"])
        assert broken["broken_total"] == 1
        assert broken_items == [
            {
                "from_path": "docs/Broken.md",
                "rel": "depends_on",
                "target": "Missing",
                "to_wikilink": "[[Missing]]",
                "resolutions": [],
            }
        ]

        vault_tree = _call_tool(
            harness.server,
            "get_vault_tree",
            path_prefix="docs",
            include_files=True,
        )
        tree_files = cast(list[str], vault_tree["files"])
        assert tree_files == ["docs/Broken.md", "docs/Child.md", "docs/Parent.md"]

        frontmatter_report = _call_tool(
            harness.server,
            "frontmatter_validate",
            path_prefix="docs/",
        )
        assert frontmatter_report["issue_count"] == 0

        context = _call_tool(
            harness.server,
            "get_context",
            query="child dependency",
            path_prefix="docs/",
            tags_any=["project"],
            top_k=2,
            expand_top_k=1,
        )
        results = cast(list[dict[str, object]], context["results"])
        params = cast(dict[str, object], context["params"])
        assert len(results) == 2
        assert {cast(str, item["path"]) for item in results} == {
            "docs/Child.md",
            "docs/Parent.md",
        }
        assert params["expand_top_k"] == 1
        assert sum(1 for item in results if item["evidence_text"] is not None) == 1
        assert sum(1 for item in results if item["evidence_chunks"]) == 1

        with pytest.raises(Exception, match="less than or equal to 20"):
            _call_tool(
                harness.server,
                "get_context",
                query="child dependency",
                top_k=21,
            )
    finally:
        harness.close()


def test_mcp_runtime_write_tools_apply_and_reindex(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    harness = _build_runtime_harness(tmp_path, monkeypatch, enable_write_tools=True)
    try:
        capture = _call_tool(
            harness.server,
            "capture_note",
            title="Fresh Capture",
            body="Captured body.",
            apply=True,
        )
        captured_path = cast(str, capture["path"])
        assert capture["applied"] is True
        assert capture["reindexed"] is True
        assert (harness.vault_path / captured_path).exists()

        captured_text = (harness.vault_path / captured_path).read_text(encoding="utf-8")
        edit = _call_tool(
            harness.server,
            "edit_note",
            path=captured_path,
            expected_sha256=capture["sha256"],
            ops=[
                {
                    "op": "insert_lines",
                    "at_line": len(captured_text.splitlines()) + 1,
                    "text": "Extra line",
                }
            ],
            apply=True,
        )
        assert edit["applied"] is True
        assert edit["changed"] is True
        assert "Extra line" in (harness.vault_path / captured_path).read_text(encoding="utf-8")

        improve = _call_tool(
            harness.server,
            "improve_frontmatter",
            path="scratch/NoFrontmatter.md",
            apply=True,
            fix_identity=True,
        )
        assert improve["applied"] is True
        assert improve["changed"] is True
        assert improve["has_frontmatter"] is False
        assert (
            (harness.vault_path / "scratch" / "NoFrontmatter.md")
            .read_text(encoding="utf-8")
            .startswith("---\n")
        )

        relocated = _call_tool(
            harness.server,
            "relocate_note",
            from_path=captured_path,
            to_path="200. Projects/Fresh Capture.md",
            apply=True,
        )
        assert relocated["applied"] is True
        assert (harness.vault_path / "100. Inbox").joinpath("Fresh Capture.md").exists() is False
        assert (harness.vault_path / "200. Projects" / "Fresh Capture.md").exists()

        canonicalized = _call_tool(
            harness.server,
            "canonicalize_typed_links",
            path="docs/Parent.md",
            apply=True,
        )
        edits = cast(list[dict[str, object]], canonicalized["edits"])
        assert canonicalized["applied"] is True
        assert len(edits) == 1
        parent_text = (harness.vault_path / "docs" / "Parent.md").read_text(encoding="utf-8")
        assert "[[docs/Child|Child]]" in parent_text

        resolved = _call_tool(harness.server, "resolve_note", query="Fresh Capture")
        best = cast(dict[str, object], resolved["best"])
        assert best["path"] == "200. Projects/Fresh Capture.md"

        incoming = _call_tool(
            harness.server,
            "find_typed_links_incoming",
            rel="depends_on",
            to_target="docs/Child",
        )
        backrefs = cast(list[dict[str, object]], incoming["backrefs"])
        assert [item["from_path"] for item in backrefs] == ["docs/Parent.md"]
    finally:
        harness.close()
