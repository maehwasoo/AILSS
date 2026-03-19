from __future__ import annotations

from .mcp_runtime import create_mcp_server_from_env


def main() -> None:
    server = create_mcp_server_from_env()
    server.run("streamable-http")
