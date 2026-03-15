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

### `packages/indexer` (`@ailss/indexer`)

Responsibilities:

- Scan the vault and incrementally index only changed files
- Generate embeddings via the OpenAI embeddings API
- Store files/chunks/embeddings into the DB
- Store normalized frontmatter + typed links for structured querying

Entry point:

- `packages/indexer/src/cli.ts` (`ailss-indexer`)

### `packages/mcp` (`@ailss/mcp`)

Responsibilities:

- Provide MCP tools backed by the local DB
- Support STDIO (Codex CLI spawns the server) and streamable HTTP (localhost, `/mcp`)

Entry points:

- `packages/mcp/src/stdio.ts` (`ailss-mcp`)
- `packages/mcp/src/http.ts` (`ailss-mcp-http`)

### `packages/obsidian-plugin`

Responsibilities:

- Provide Obsidian surfaces for indexing, the localhost MCP service, and the local Python backend
- Spawn the indexer, MCP server/service, and Python backend locally (desktop-only for now)
- Apply changes only via explicit user actions (gated)

### `apps/api` (`ailss-api`)

Responsibilities:

- Provide the FastAPI backend surface for `GET /health`, `POST /retrieve`, `POST /agent/run`, and `POST /eval/run`
- Reuse the local SQLite index for semantic and lexical retrieval
- Run the LangGraph-backed agent workflow and local eval/artifact flow
- Expose a guarded shutdown endpoint for plugin-managed local process cleanup

Entry point:

- `apps/api/src/ailss_api/cli.py` (`ailss-api`)

## Dependency direction

```
core  <-  indexer
core  <-  mcp
plugin -> spawns indexer
plugin -> spawns mcp
plugin -> spawns api
api -> reads vault/db directly
```

## Configuration principles

- Vault path is provided via external configuration
- The local DB default is `<vault>/.ailss/index.sqlite`
- The plugin-managed Python backend default port is `8787`
