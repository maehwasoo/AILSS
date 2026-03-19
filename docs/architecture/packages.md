# Architecture: package structure

This document defines the package and app boundaries in this repo.

## Monorepo overview

- Package manager: pnpm workspace
- Package root: `packages/*`
- Application root: `apps/*`

## Packages

### `packages/core` (`@ailss/core`)

Responsibilities:

- Vault file system access utilities
- Markdown parsing/chunking
- Frontmatter normalization + typed-link extraction
- SQLite DB schema/queries (including vector search)
- Environment variable loading

Constraints:

- Must not depend on other packages (lowest layer)

### `packages/obsidian-plugin`

Responsibilities:

- Provide Obsidian surfaces for indexing, the localhost MCP service, and the local Python backend
- Spawn the Python indexer, Python MCP service, and Python backend locally (desktop-only for now)
- Apply changes only via explicit user actions (gated)

### `apps/api` (`ailss-api`)

Responsibilities:

- Provide the FastAPI backend surface for `GET /health`, `POST /retrieve`, `POST /agent/run`, and `POST /eval/run`
- Provide the Python MCP HTTP surface and the Python indexer CLI
- Reuse the local SQLite index for semantic and lexical retrieval
- Run the LangGraph-backed agent workflow and local eval/artifact flow
- Expose a guarded shutdown endpoint for plugin-managed local process cleanup

Entry point:

- `apps/api/src/ailss_api/cli.py` (`ailss-api`)
- `apps/api/src/ailss_api/mcp_cli.py` (`ailss-mcp-http`)
- `apps/api/src/ailss_api/indexer_cli.py` (`ailss-indexer`)

## Dependency direction

```
core <- api (reference utilities only)
plugin -> spawns api
api -> reads vault/db directly
```

## Configuration principles

- Vault path is provided via external configuration
- The local DB default is `<vault>/.ailss/index.sqlite`
- The plugin-managed Python backend default port is `8787`
