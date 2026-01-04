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
- SQLite DB schema/queries (including vector search)
- Environment variable loading

Constraints:

- Must not depend on other packages (lowest layer)

### `packages/indexer` (`@ailss/indexer`)

Responsibilities:

- Scan the vault and incrementally index only changed files
- Generate embeddings via the OpenAI embeddings API
- Store files/chunks/embeddings into the DB

Entry point:

- `packages/indexer/src/cli.ts` (`ailss-indexer`)

### `packages/mcp` (`@ailss/mcp`)

Responsibilities:

- Provide search/query tools backed by the local DB
- Default transport starts with STDIO (for Codex CLI integration)

Entry point:

- `packages/mcp/src/stdio.ts` (`ailss-mcp`)

### `packages/obsidian-plugin`

Planned responsibilities:

- Show recommendations in the UI
- Apply changes only via explicit user actions

## Dependency direction

```
core  <-  indexer
core  <-  mcp
plugin (separate; wired later)
```

## Configuration principles

- Vault path is provided via external configuration
- The local DB default is `<vault>/.ailss/index.sqlite`
