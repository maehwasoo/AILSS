# AGENTS.md (packages/core)

## What this folder is

`@ailss/core` is the **shared library / reference layer** that remains in the repo after the
Node runtime removal.

## What it does

- Vault filesystem and parsing helpers (markdown/frontmatter)
- Local DB helpers (SQLite schema, queries, migrations)
- Shared types/utilities kept for package-level references and schema drift checks

## Entry points

- Public entry: `packages/core/src/index.ts`
- Env loading: `packages/core/src/env.ts`

## Boundaries

- Must **not** depend on other workspace packages.
- Avoid CLI concerns (arg parsing, `process.exit`, user-facing output) — active runtime
  ownership now lives in `apps/api`.
- Treat vault paths as untrusted input; guard against path traversal.

## Conventions

- Keep the public API explicit via `packages/core/src/index.ts` (avoid deep imports from other packages).
- Prefer small, focused modules and minimize side effects.
