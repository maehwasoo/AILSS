# 0002. Desktop-first + local DB (SQLite + sqlite-vec)

status: accepted

## Context

- The initial goal is to use search via MCP tools directly from Codex CLI
- Supporting mobile early increases plugin constraints (especially around native modules) and slows down development
- Vector search should be fast and reproducible on local machines

## Decision

- Design the first iteration as desktop-only (desktop-first)
- Vault path is configured externally, not inside the repo (`AILSS_VAULT_PATH`)
- Use local SQLite as the vector store, with vector search via sqlite-vec
- API keys are managed only in local `.env` (do not commit)

## Consequences

- Pros
  - Faster to build an MVP
  - Data stays local, reducing privacy risk
- Cons / risks
  - Mobile support will require a separate architecture review (server/sync)
  - Native module build issues (better-sqlite3) may occur in some environments

## Alternatives

- Hosted/remote vector DB
  - Pros: easier sharing/deployment
  - Cons: higher privacy, cost, and operational burden
