# AGENTS.md (packages/mcp)

## What this folder is

`@ailss/mcp` is the **Model Context Protocol (MCP)** server for AILSS.

## What it does

- Exposes tools (read/search/index/edit) over stdio and HTTP
- Uses `@ailss/core` for vault/DB primitives
- Uses the OpenAI SDK for embeddings where required

## Entry points

- Stdio server entry: `packages/mcp/src/stdio.ts`
- HTTP server entry: `packages/mcp/src/http.ts`
- Server wiring: `packages/mcp/src/createAilssMcpServer.ts`

## Boundaries

- Default stance is **read-first**: file writes should be explicit, safe, and guarded.
- Tool input/output shapes are external API; avoid breaking changes without updating docs/tests.
- Treat vault paths as untrusted input; guard against path traversal.

## Conventions

- Tool implementations live in `packages/mcp/src/tools/*`.
- When adding/changing tools, update the user-facing documentation in `docs/01-overview.md`.
