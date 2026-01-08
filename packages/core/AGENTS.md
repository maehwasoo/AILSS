# AGENTS.md (packages/core)

## What this folder is

`@ailss/core` is the **shared library** used by the CLI (`@ailss/indexer`) and MCP server (`@ailss/mcp`).

## What it does

- Vault filesystem and parsing helpers (markdown/frontmatter)
- Local DB helpers (SQLite schema, queries, migrations)
- Shared types/utilities used across packages

## Entry points

- Public entry: `packages/core/src/index.ts`
- Env loading: `packages/core/src/env.ts`

## Boundaries

- Must **not** depend on other workspace packages.
- Avoid CLI concerns (arg parsing, `process.exit`, user-facing output) — those belong in `@ailss/indexer` or `@ailss/mcp`.
- Treat vault paths as untrusted input; guard against path traversal.

## Conventions

- Keep the public API explicit via `packages/core/src/index.ts` (avoid deep imports from other packages).
- Prefer small, focused modules and minimize side effects.
