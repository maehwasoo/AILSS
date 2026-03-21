from __future__ import annotations

import os
import signal
import sqlite3
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Literal

from mcp.server.auth.provider import AccessToken, TokenVerifier
from openai import OpenAI

from .config import Settings
from .indexer_runtime import IndexVaultOptions, index_vault
from .tool_failure_diagnostics import ToolFailureDiagnostics


def _now_iso_seconds() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _sha256_hex_utf8(text: str) -> str:
    from hashlib import sha256

    return sha256(text.encode("utf-8")).hexdigest()


def _terminate_current_process() -> None:
    time.sleep(0.1)
    os.kill(os.getpid(), signal.SIGTERM)


class FixedBearerTokenVerifier(TokenVerifier):
    def __init__(self, token: str) -> None:
        self._token = token

    async def verify_token(self, token: str) -> AccessToken | None:
        if token != self._token:
            return None
        return AccessToken(token=token, client_id="ailss-localhost", scopes=["*"])


class McpRuntime:
    def __init__(
        self,
        *,
        settings: Settings,
        conn: sqlite3.Connection,
        openai_client: OpenAI,
        diagnostics: ToolFailureDiagnostics,
        enable_write_tools: bool,
        default_top_k: int,
        shutdown_token: str,
    ) -> None:
        self.settings = settings
        self.conn = conn
        self.openai_client = openai_client
        self.diagnostics = diagnostics
        self.enable_write_tools = enable_write_tools
        self.default_top_k = default_top_k
        self.shutdown_token = shutdown_token
        self.write_lock = threading.Lock()
        self.db_path = settings.resolved_db_path
        self.vault_path = settings.resolved_vault_path

    def call_tool(
        self,
        tool: str,
        args: Mapping[str, object],
        fn: Callable[[], dict[str, object]],
    ) -> dict[str, object]:
        try:
            return fn()
        except Exception as error:
            self.diagnostics.log_tool_failure(tool=tool, args=args, error=error)
            raise

    def apply_and_optional_reindex(
        self,
        *,
        apply: bool,
        changed: bool,
        reindex_after_apply: bool,
        reindex_paths: list[str],
        apply_write: Callable[[], None],
    ) -> dict[str, object]:
        applied = bool(apply and changed)
        if not applied:
            return {
                "applied": False,
                "needs_reindex": False,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": None,
            }

        apply_write()

        if not reindex_after_apply:
            return {
                "applied": True,
                "needs_reindex": True,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": None,
            }

        try:
            summary = self.reindex_paths(reindex_paths)
            return {
                "applied": True,
                "needs_reindex": False,
                "reindexed": True,
                "reindex_summary": summary,
                "reindex_error": None,
            }
        except Exception as error:
            return {
                "applied": True,
                "needs_reindex": True,
                "reindexed": False,
                "reindex_summary": None,
                "reindex_error": str(error),
            }

    def reindex_paths(self, paths: list[str]) -> dict[str, int]:
        if self.db_path is None or self.vault_path is None:
            raise RuntimeError(
                "Reindexing requires both AILSS_DB_PATH and AILSS_VAULT_PATH to be configured."
            )
        summary = index_vault(
            IndexVaultOptions(
                conn=self.conn,
                db_path_for_log=str(self.db_path),
                vault_path=self.vault_path,
                openai=self.openai_client,
                embedding_model=self.settings.openai_embedding_model,
                paths=paths,
            )
        )
        return {
            "changed_files": summary.changed_files,
            "indexed_chunks": summary.indexed_chunks,
            "deleted_files": summary.deleted_files,
        }

    def ensure_vault_path(self) -> Path:
        if self.vault_path is None:
            raise RuntimeError("AILSS_VAULT_PATH is not set.")
        return self.vault_path

    def ensure_markdown_path(self, vault_rel_path: str, *, action: str) -> None:
        if not vault_rel_path.lower().endswith(".md"):
            raise RuntimeError(f'Refusing to {action} non-markdown file: path="{vault_rel_path}".')


class _noop_context:
    def __enter__(self) -> None:
        return None

    def __exit__(
        self,
        exc_type: object,
        exc: object,
        tb: object,
    ) -> Literal[False]:
        return False
