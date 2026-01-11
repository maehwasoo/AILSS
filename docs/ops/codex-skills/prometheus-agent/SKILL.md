---
name: ailss-prometheus-agent
description: Retrieval-first AILSS vault workflow for Codex CLI (MCP read tools first; explicit gated writes)
mcp_tools:
  # Always available (read tools)
  - get_context
  - get_typed_links
  - resolve_note
  - read_note
  - get_vault_tree
  - frontmatter_validate
  - find_broken_links
  - find_typed_link_backrefs
  - search_notes
  - list_tags
  - list_keywords
  - suggest_typed_links
  # Only when write tools are enabled (AILSS_ENABLE_WRITE_TOOLS=1)
  - capture_note
  - edit_note
  - improve_frontmatter
  - relocate_note
---

# Prometheus Agent (AILSS Codex skill)

Use this skill when you want to work **retrieval-first** against an AILSS Obsidian vault.

## Core workflow

1. Start with `get_context` for the user’s query (avoid guessing and avoid duplicates).
2. Use `get_typed_links` to navigate the semantic graph from a specific note (DB-backed).
   - Typed links are directional: link from the current note to what it uses/depends_on/part_of/implements/see_also; do not add reciprocal links unless explicitly requested.
3. Use `resolve_note` when you only have `id`/`title`/a wikilink target and need a vault-relative path for `read_note`/`edit_note`.
4. Use `read_note` to confirm exact wording and frontmatter before making claims.
5. Use `search_notes` for metadata filtering (entity/layer/status/tags/keywords/source/date ranges) without embeddings calls.
6. Keep relationships in frontmatter only:
   - Record semantic relations as typed-link keys in YAML frontmatter (not a `## Links` section at the end of the note).
   - Avoid adding wikilinks to tool names or input keys (e.g. `[[sequentialthinking]]`, `[[session_note_id]]`) unless there is an actual vault note with that title.

## Tool availability (important)

- Read tools are always registered.
- Write tools are **not** registered by default. They require `AILSS_ENABLE_WRITE_TOOLS=1`.
- If a write tool is missing, do not “simulate” a write. Ask the user to enable write tools or proceed read-only.

## Obsidian grammar (titles + links)

- Titles are filenames: keep them cross-device safe (especially for Sync).
  - Avoid: `\\` `/` `:` `*` `?` `"` `<` `>` `|` `#` `^` and `%%` / `[[` / `]]`.
  - Prefer using only letters/numbers/spaces plus `-` and `_` when in doubt.
- If you need the full path in a wikilink (disambiguation), hide it with display text:
  - Example: `[[20. Areas/50. AILSS/20. 운영(Operations)/20. 운영(Operations)|20. 운영(Operations)]]`

## Safe writes (when enabled)

- Default policy for `capture_note` / `edit_note` / `improve_frontmatter`: do `apply=false` preview, then proceed with `apply=true` automatically (auto-apply).
  - Only pause when the user explicitly requests “preview only” or the preview indicates a suspicious target.
- For edits, use `expected_sha256` to avoid overwriting concurrent changes.
- Keep identity fields safe: do not override `id`/`created` unless the user explicitly requests it.

## Common recipes

### Create a new note (`capture_note`)

1. Run `get_context` with the intended topic/title to avoid duplicates and reuse existing naming.
2. Draft a new note (title + frontmatter overrides that match the content).
   - Prefer reusing existing tags/keywords: call `list_tags` / `list_keywords` first.
   - Write the body for future reading/maintenance (not raw chat):
     - short `summary`
     - key points (bullets)
     - next actions + open questions
     - references (either `source: []` or `cites` typed links)
3. Call `capture_note` with `apply=false` to preview the resulting path + sha256.
4. Confirm with the user.
5. Call `capture_note` again with `apply=true`.

Notes:

- Let `capture_note` generate `id`/`created`/`updated` unless the user explicitly wants overrides.
- `capture_note` timestamps follow system local time (no fixed timezone) and are stored as ISO to seconds without a timezone suffix (`YYYY-MM-DDTHH:mm:ss`).
- Prefer setting non-default fields via `frontmatter` overrides when known: `entity`, `layer`, `status`, `summary`, and optionally `tags`, `keywords`, `source`.
- Typed links are optional; if you include typed links, only include keys that have values.
- Typed links are one-way; link from the current note outward based on how it relates to other notes.

### Improve frontmatter (`improve_frontmatter`)

1. Read the note with `read_note`.
2. Call `improve_frontmatter` with `apply=false` first.
3. Confirm the proposed changes, then `apply=true`.

### Apply typed-link suggestions (`suggest_typed_links` → `edit_note`)

1. Use `suggest_typed_links` to propose candidates.
2. Verify with `read_note` before editing (especially for ambiguous titles).
3. Apply via `edit_note`:
   - `apply=false` preview → confirm → `apply=true`

### Move/rename a note (`relocate_note`)

1. Call `relocate_note` with `apply=false` to preview the move.
2. Confirm, then call again with `apply=true`.

## Preflight

If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.
