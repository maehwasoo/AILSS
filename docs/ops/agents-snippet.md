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
     - `read_note` is path-based. If you only have `id`/`title`/a wikilink target, call `resolve_note` first to get candidate paths.
   - For metadata filtering (entity/layer/status/tags/keywords/source/date ranges), use `search_notes` (DB-only; no embeddings).
   - Before adding new tags/keywords, prefer reusing existing vocabulary via `list_tags` / `list_keywords`.
   - If you need typed-link navigation starting from a specific note path, call `get_typed_links` (outgoing only; bounded graph).
   - Typed links are directional: link from the current note to what it uses/depends_on/part_of/implements/see_also; do not add reciprocal links unless explicitly requested.
   - If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.

2. Structure + validation
   - Use `get_vault_tree` when you need a filesystem folder tree for the vault.
   - Use `frontmatter_validate` when you need to audit frontmatter health (required keys + id/created consistency).

3. Safe edits (explicit apply only)
   - Prefer `apply=false` first to preview changes.
   - For new notes, prefer `capture_note` so required frontmatter keys exist and `id` matches `created`.
     - When capturing, set non-default frontmatter via `frontmatter` overrides (at least `entity`/`layer`/`status`/`summary` when known).
     - Prefer reusing existing `tags`/`keywords` by checking `list_tags` / `list_keywords` first (avoid near-duplicates).
     - Write the note body to be readable later
   - Default policy for `capture_note` / `edit_note` / `improve_frontmatter`: do `apply=false` preview, then proceed with `apply=true` automatically (auto-apply).
     - Only pause when the user explicitly requests “preview only” or the preview indicates a suspicious target.
   - Do not override identity fields (`id`, `created`) unless the user explicitly asks.
   - Timestamps:
     - `capture_note` generates `id`/`created`/`updated` using system local time (no fixed timezone) and stores them as ISO to seconds without a timezone suffix (`YYYY-MM-DDTHH:mm:ss`).
   - For line-based edits, fetch the note via `read_note`, then compute exact anchors + line numbers (do not guess).
   - Use `expected_sha256` to avoid overwriting concurrent edits.
   - Only set `apply=true` after confirming the target path + patch ops are correct.
   - Update frontmatter `updated` as part of the same edit operation (avoid “content changed but updated not bumped” drift).
   - After `apply=true`, confirm `reindex_summary` so the DB stays consistent.

4. Scope discipline
   - Treat the Obsidian vault as the Single Source of Truth (SSOT).
   - Do not invent facts not present in notes; if something is missing, say so and propose where to add it.
   - Keep edits minimal and auditable (small patch ops; no mass rewrites without explicit request).
   - Keep relationships in frontmatter only:
     - Record semantic relations as typed-link keys in YAML frontmatter (not a `## Links` section at the end of the note).
     - Avoid adding wikilinks to tool names or input keys (e.g. `[[sequentialthinking]]`, `[[session_note_id]]`) unless there is an actual vault note with that title.
```

## Notes

- Canonical vault rules (frontmatter, typed links, vault writing conventions) live in this repo: `docs/standards/vault/README.md`.
- This repo’s MCP write tools are gated in the Obsidian plugin and still require `apply=true`.
- For tool/transport details, see `docs/ops/codex-cli.md`.
