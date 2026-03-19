from __future__ import annotations

import os
import threading
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from openai import OpenAI
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import Settings
from .index_db import OpenIndexDbOptions, embedding_dim_for_model, open_index_db
from .mcp_runtime_core import FixedBearerTokenVerifier, McpRuntime, _terminate_current_process
from .mcp_runtime_read_tools import register_read_tools
from .mcp_runtime_write_tools import register_write_tools
from .tool_failure_diagnostics import ToolFailureDiagnostics

__all__ = ["McpRuntime", "create_mcp_server_from_env", "register_mcp_tools"]


def create_mcp_server_from_env() -> FastMCP:
    settings = Settings()
    db_path = settings.resolved_db_path
    if db_path is None:
        raise RuntimeError("DB path is missing. Set AILSS_VAULT_PATH or AILSS_DB_PATH.")

    openai_api_key = (settings.openai_api_key or "").strip()
    if not openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is missing. Set it via .env or environment variables.")

    token = os.environ.get("AILSS_MCP_HTTP_TOKEN", "").strip()
    if not token:
        raise RuntimeError("AILSS_MCP_HTTP_TOKEN is required for the MCP HTTP service.")

    shutdown_token = os.environ.get("AILSS_MCP_HTTP_SHUTDOWN_TOKEN", "").strip()
    if not shutdown_token:
        raise RuntimeError("AILSS_MCP_HTTP_SHUTDOWN_TOKEN is required for the MCP HTTP service.")

    host = os.environ.get("AILSS_MCP_HTTP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.environ.get("AILSS_MCP_HTTP_PORT", "31415").strip() or "31415")
    streamable_http_path = os.environ.get("AILSS_MCP_HTTP_PATH", "/mcp").strip() or "/mcp"
    default_top_k = int(os.environ.get("AILSS_GET_CONTEXT_DEFAULT_TOP_K", "10").strip() or "10")

    conn = open_index_db(
        OpenIndexDbOptions(
            db_path=db_path,
            embedding_model=settings.openai_embedding_model,
            embedding_dim=embedding_dim_for_model(settings.openai_embedding_model),
        )
    )
    runtime = McpRuntime(
        settings=settings,
        conn=conn,
        openai_client=OpenAI(api_key=openai_api_key),
        diagnostics=ToolFailureDiagnostics(vault_path=settings.resolved_vault_path, cwd=Path.cwd()),
        enable_write_tools=os.environ.get("AILSS_ENABLE_WRITE_TOOLS", "").strip() == "1",
        default_top_k=max(1, min(default_top_k, 20)),
        shutdown_token=shutdown_token,
    )

    server = FastMCP(
        name="ailss-mcp",
        host=host,
        port=port,
        streamable_http_path=streamable_http_path,
        token_verifier=FixedBearerTokenVerifier(token),
    )
    register_mcp_tools(server, runtime)

    @server.custom_route("/__ailss/shutdown", methods=["POST"], include_in_schema=False)  # type: ignore[untyped-decorator]
    async def shutdown(request: Request) -> Response:
        authorization = request.headers.get("Authorization")
        if authorization != f"Bearer {runtime.shutdown_token}":
            return JSONResponse({"detail": "Invalid shutdown token."}, status_code=401)
        threading.Thread(target=_terminate_current_process, daemon=True).start()
        return JSONResponse({"status": "ok"})

    return server


def register_mcp_tools(server: FastMCP, runtime: McpRuntime) -> None:
    register_read_tools(server, runtime)
    if runtime.enable_write_tools:
        register_write_tools(server, runtime)
