# AGENTS.md snippet (AILSS MCP usage)

This page provides a ready-to-paste snippet for a user/workspace `AGENTS.md` so an LLM-driven coding agent uses AILSS MCP tools consistently and safely.

## Paste into your `AGENTS.md`

```md
## AILSS MCP workflow (vault notes = SSOT)

When the `ailss` MCP server is available:

1. Retrieval-first
   - Always call `get_context` first for any task that might depend on vault knowledge.
   - Use the returned note previews + snippets as the primary grounding source.
   - If you need exact wording/fields, fetch the full note via `read_note` (not assumptions).
   - If you need typed-link navigation starting from a specific note path, call `get_typed_links` (incoming + outgoing, up to 2 hops).
   - If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.

2. Structure + validation
   - Use `get_vault_tree` when you need a filesystem folder tree for the vault.
   - Use `frontmatter_validate` when you need to audit frontmatter health (required keys + id/created consistency).

3. Safe edits (explicit apply only)
   - Prefer `apply=false` first to preview changes.
   - For line-based edits, fetch the note via `read_note`, then compute exact anchors + line numbers (do not guess).
   - Use `expected_sha256` to avoid overwriting concurrent edits.
   - Only set `apply=true` after confirming the target path + patch ops are correct.
   - Update frontmatter `updated` as part of the same edit operation (avoid “content changed but updated not bumped” drift).
   - After `apply=true`, confirm `reindex_summary` so the DB stays consistent.

4. Scope discipline
   - Treat the Obsidian vault as the Single Source of Truth (SSOT).
   - Do not invent facts not present in notes; if something is missing, say so and propose where to add it.
   - Keep edits minimal and auditable (small patch ops; no mass rewrites without explicit request).
```

## Notes

- Canonical vault rules (frontmatter, typed links, vault writing conventions) live in this repo: `docs/standards/vault/README.md`.
- This repo’s MCP write tools are gated in the Obsidian plugin and still require `apply=true`.
- For tool/transport details, see `docs/ops/codex-cli.md`.
