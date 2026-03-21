from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .mcp_runtime_context_tools import register_context_tools
from .mcp_runtime_core import McpRuntime
from .mcp_runtime_link_tools import register_link_tools
from .mcp_runtime_vault_tools import register_vault_tools


def register_read_tools(server: FastMCP, runtime: McpRuntime) -> None:
    register_context_tools(server, runtime)
    register_link_tools(server, runtime)
    register_vault_tools(server, runtime)
