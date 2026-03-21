# Testing

AILSS uses **Vitest** for the remaining TypeScript packages/plugin and **pytest** for the
Python service/runtime.

## Quick start

- Run the full test suite: `pnpm test`
- Run the full test suite with coverage: `pnpm test:coverage`
- Run typecheck (includes test files): `pnpm typecheck:repo`
- Run Python tests only: `pnpm py:test`
- Run Python tests with coverage: `pnpm py:test:coverage`
- Run the Python quality gate: `pnpm py:check`
- Run the full local quality gate (format + lint + typecheck + tests): `pnpm check`

## Test layout

Tests live under each package or app:

- `packages/core/test/**/*.test.ts` — pure utilities and indexing behavior (offline)
- `packages/obsidian-plugin/test/**/*.test.ts` — plugin service controllers and settings behavior
- `apps/api/tests/**/*.py` — FastAPI routes, Python MCP/indexer behavior, retrieval, and backend lifecycle behavior

## What we test (examples)

### Core: frontmatter normalization

File: `packages/core/test/frontmatter.test.ts`

- Typed link normalization into stable wikilink form
- YAML scalar coercion (`id` as number, `created`/`updated` as Date → string)
- `source` normalization (trim + dedupe) into a stable string list

### Python MCP runtime: parity surface + reindex behavior

File: `apps/api/tests/test_mcp_runtime.py`

- Registered read/write tool names match the shipped Python MCP surface
- Read tools resolve notes, typed links, broken links, vault tree, and semantic retrieval
- Write tools apply changes and reindex the DB through the Python owner path

### Python backend: API contract and shutdown guard

File: `apps/api/tests/test_health.py`, `apps/api/tests/test_retrieve.py`, `apps/api/tests/test_shutdown.py`

- `GET /health` returns the current local readiness shape
- `POST /retrieve`, `POST /agent/run`, and `POST /eval/run` fail explicitly when the index or dataset is not ready
- `POST /__ailss/shutdown` requires the configured shutdown token

## Rules for tests (important)

- Default tests must pass **without network access**.
- Do not call paid/non-deterministic APIs directly from tests; inject interfaces and mock them.
  - See `docs/standards/quality-gates.md` for more detail.
