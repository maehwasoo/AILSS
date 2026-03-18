# Testing

AILSS uses **Vitest** for the Node/TypeScript packages and **pytest** for the Python
backend.

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
- `packages/indexer/test/**/*.test.ts` — indexer integration behavior (offline)
- `packages/mcp/test/**/*.test.ts` — MCP protocol and HTTP server behaviors (offline)
- `packages/obsidian-plugin/test/**/*.test.ts` — plugin service controllers and settings behavior
- `apps/api/tests/**/*.py` — FastAPI routes, retrieval, and backend lifecycle behavior

## What we test (examples)

### Core: frontmatter normalization

File: `packages/core/test/frontmatter.test.ts`

- Typed link normalization into stable wikilink form
- YAML scalar coercion (`id` as number, `created`/`updated` as Date → string)
- `source` normalization (trim + dedupe) into a stable string list

### MCP: frontmatter_validate behavior

File: `packages/mcp/test/httpTools.frontmatterValidate.test.ts`

- Valid notes count as ok when required keys exist
- Notes without frontmatter are reported as issues
- Notes with frontmatter but missing required keys (for example `source`) are reported as issues

### Python backend: API contract and shutdown guard

File: `apps/api/tests/test_app.py`

- `GET /health` returns the current local readiness shape
- `POST /retrieve`, `POST /agent/run`, and `POST /eval/run` fail explicitly when the index or dataset is not ready
- `POST /__ailss/shutdown` requires the configured shutdown token

## Rules for tests (important)

- Default tests must pass **without network access**.
- Do not call paid/non-deterministic APIs directly from tests; inject interfaces and mock them.
  - See `docs/standards/quality-gates.md` for more detail.
