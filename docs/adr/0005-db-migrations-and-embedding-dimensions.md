# 0005. DB migration policy and embedding dimension constraints

status: accepted

## Context

- The vector index uses `sqlite-vec` (`vec0`) which fixes the embedding vector dimension at table creation time.
- OpenAI embedding models can have different default dimensions (e.g. 1536 vs 3072).
- The current DB migration approach is “create tables if missing” (no schema version table yet).
- The DB stores identity/config keys (e.g. embedding model/dimension) in a small `db_meta` table.

## Decision

- Treat the embedding model **and** its dimension as part of the DB’s identity:
  - If `OPENAI_EMBEDDING_MODEL` changes (even if the dimension stays the same), the DB must be **recreated** and the vault reindexed.
  - If the dimension changes, the DB must be **recreated** (vec0 dimension is fixed at creation time).
- Keep migrations simple for now:
  - Use “create-if-not-exists” schema setup.
  - When a schema change is not backward-compatible, prefer a DB rebuild until we introduce explicit schema versioning.

## Consequences

- Pros
  - Minimal migration complexity
  - Avoids silent corruption when dimensions mismatch
- Cons / risks
  - Model changes can require a full reindex (time + API cost)
  - Without explicit schema versions, upgrades rely on documentation and discipline

## Alternatives

- Store a schema version and run explicit migrations
  - Pros: smoother upgrades
  - Cons: more engineering overhead; more failure modes
- Maintain separate DBs per embedding model/dimension
  - Pros: avoids rebuild in some workflows
  - Cons: storage overhead; more configuration complexity
