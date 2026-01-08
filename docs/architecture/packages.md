# Architecture: package structure

This document defines the package structure and boundaries in this repo.

## Monorepo overview

- Package manager: pnpm workspace
- Package root: `packages/*`

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

- Provide an Obsidian UI for semantic search and recommendations
- Spawn the indexer and MCP server/service locally (desktop-only for now)
- Apply changes only via explicit user actions (gated)

## Dependency direction

```
core  <-  indexer
core  <-  mcp
plugin (separate; spawns local processes)
```

## Configuration principles

- Vault path is provided via external configuration
- The local DB default is `<vault>/.ailss/index.sqlite`
