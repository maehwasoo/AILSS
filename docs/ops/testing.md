# Testing

AILSS uses **Vitest** for tests.

## Quick start

- Run the full test suite: `pnpm test`
- Run the full test suite with coverage: `pnpm test:coverage`
- Run typecheck (includes test files): `pnpm typecheck:repo`
- Run the full local quality gate (format + lint + typecheck + tests): `pnpm check`

## Test layout

Tests live under each package:

- `packages/core/test/**/*.test.ts` — pure utilities and indexing behavior (offline)
- `packages/indexer/test/**/*.test.ts` — indexer integration behavior (offline)
- `packages/mcp/test/**/*.test.ts` — MCP protocol and HTTP server behaviors (offline)

## What we test (examples)

### Core: frontmatter normalization

File: `packages/core/test/frontmatter.test.ts`

- Typed link normalization into stable wikilink form
- YAML scalar coercion (`id` as number, `created`/`updated` as Date → string)
- `source` normalization (trim + dedupe) into a stable string list

### MCP: frontmatter_validate behavior

File: `packages/mcp/test/httpTools.readTools.test.ts`

- Valid notes count as ok when required keys exist
- Notes without frontmatter are reported as issues
- Notes with frontmatter but missing required keys (for example `source`) are reported as issues

## Rules for tests (important)

- Default tests must pass **without network access**.
- Do not call paid/non-deterministic APIs directly from tests; inject interfaces and mock them.
  - See `docs/standards/quality-gates.md` for more detail.
