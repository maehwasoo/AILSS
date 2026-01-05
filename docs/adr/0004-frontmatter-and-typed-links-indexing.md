# 0004. Index frontmatter fields and typed links for structured queries

status: accepted

## Context

- The vault rules define a frontmatter schema and “typed links” (relations like `part_of`, `depends_on`, etc.).
- The MCP server needs fast, predictable structured queries in addition to semantic search.
- Relying on SQLite JSON querying (`json1`) everywhere is not ideal across environments and can be slower than indexed columns.
- We still want to preserve the full normalized frontmatter payload for future features.

## Decision

- Normalize frontmatter during indexing:
  - Deduplicate/normalize `tags` and `keywords` into stable arrays
  - Normalize typed-link values into canonical wikilinks and “targets” (display text and headings removed)
- Store structured query primitives in dedicated tables/columns:
  - `notes` table with commonly queried fields (e.g. `entity`, `layer`, `status`, `created`, `updated`, etc.)
  - mapping tables `note_tags` and `note_keywords` for fast filtering
  - `typed_links` table for relation graph queries (`rel` + normalized target)
- Store the full normalized frontmatter JSON as `notes.frontmatter_json` for future tool support.

## Consequences

- Pros
  - Fast structured filters without depending on SQLite JSON functions
  - Typed-link “backrefs” queries are simple and index-friendly
  - Full frontmatter remains available for future features
- Cons / risks
  - Not all frontmatter keys are directly queryable without additional indexing
  - Schema changes require care (and potentially DB rebuilds)

## Alternatives

- Store all frontmatter only as JSON and query via JSON functions
  - Pros: flexible schema
  - Cons: portability/performance concerns; harder indexing
- Store all frontmatter as an EAV/KV table (key/value rows)
  - Pros: arbitrary key querying
  - Cons: more complex queries and indexes; more storage overhead
