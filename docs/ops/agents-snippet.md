# AGENTS.md snippet (AILSS MCP usage)

This page provides a ready-to-paste snippet for a user/workspace `AGENTS.md` so an LLM-driven coding agent uses AILSS MCP tools consistently and safely.

## Paste into your `AGENTS.md`

```md
## AILSS MCP workflow (Obsidian vault = SSOT)

When the `ailss` MCP server is available:

1. Retrieval-first
   - Always call `activate_context` first for any task that might depend on vault knowledge.
   - Use the returned note previews + evidence links as the primary grounding source.
   - If you need exact wording/fields, fetch the full note via `get_note` (not assumptions).

2. Structured search
   - Use `search_notes` for frontmatter-derived filters (id/entity/layer/status/tags/keywords).
   - Use `find_notes_by_typed_link` for typed-link backrefs / relationship queries.
   - Use `semantic_search` only when you need similarity-based recall (top_k evidence).

3. Safe edits (explicit apply only)
   - Prefer `apply=false` first to preview changes.
   - Use `expected_sha256` to avoid overwriting concurrent edits.
   - Only set `apply=true` after confirming the target path + patch ops are correct.
   - After `apply=true`, confirm `reindex_summary` (or run `reindex_paths`) so the DB stays consistent.

4. Scope discipline
   - Treat the Obsidian vault as the Single Source of Truth (SSOT).
   - Do not invent facts not present in notes; if something is missing, say so and propose where to add it.
   - Keep edits minimal and auditable (small patch ops; no mass rewrites without explicit request).
```

## Notes

- This repo’s MCP write tools are gated in the Obsidian plugin and still require `apply=true`.
- For tool/transport details, see `docs/ops/codex-cli.md`.
