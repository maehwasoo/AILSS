# Coding conventions

This document defines coding conventions for the AILSS codebase.

## Language / runtime

- TypeScript + Node.js
- ESM (ECMAScript Modules) (`"type": "module"`)
- tsconfig is based on `tsconfig.base.json`, and strict mode must remain enabled

## Package structure and dependency direction

- `@ailss/core` contains shared logic only (must not depend on other packages)
- `@ailss/indexer` and `@ailss/mcp` may depend only on `@ailss/core`
- The MCP server provides read-only tools by default (file writes must be a separate explicit action)

## Environment variables

- Local development may use `.env` (see `.env.example`)
- Environment loading in code is standardized via `@ailss/core/src/env.ts` `loadEnv()`
- If required values are missing, throw an error that enables the next action (what to set / how to fix)

## Files / modules

- Filenames are lowercase by default; use hyphens when needed
- Use ESM import/export only (no `require`)
- Symbols meant for cross-package use must be exposed via `packages/*/src/index.ts` or explicit entry points

## Comments

- Comments are short noun phrases in English (e.g. `// DB schema migration`)
- If the explanation gets long, move it to docs instead of comments

## Errors / logs

- The CLI (indexer) may use `console.log` for progress output
- The MCP server must return clear errors on input validation failure
- Error messages should be phrased as “cause + next action”

## Format / lint / test

- Formatting uses Prettier, and lint uses ESLint
- Default integrated check is `pnpm check`
- Do not call external networks (e.g. OpenAI) directly in offline tests; isolate via injection or mocks
  - See: `docs/standards/quality-gates.md`

## Security / privacy defaults

- Vault path comes from external configuration, and must guard against path traversal
- The MCP server must not write files by default
- Do not commit API keys (`.env` is in `.gitignore`)
