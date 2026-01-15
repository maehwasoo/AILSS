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
   - Avoid adding wikilinks to tool names or input keys unless there is an actual vault note with that title (examples below).

```md
[[sequentialthinking]]
[[session_note_id]]
```

## Extended workflow (AGENTS.md-level detail)

Treat the Obsidian vault as the Single Source of Truth (SSOT): always ground claims in `get_context`/`read_note`, and do not invent facts not present in notes.

### Retrieval-first

- Always call `get_context` first for any task that might depend on vault knowledge.
- Use returned note previews/snippets as the primary grounding source.
- If you need exact wording/fields, fetch the full note via `read_note` (do not assume).
  - `read_note` is path-based. If you only have `id`/`title`/a wikilink target, call `resolve_note` first.
- For metadata filtering (entity/layer/status/tags/keywords/source/date ranges), use `search_notes` (DB-only; no embeddings).
- Before adding new tags/keywords, prefer reusing existing vocabulary via `list_tags` / `list_keywords`.
- If you need typed-link navigation starting from a specific note path, call `get_typed_links` (outgoing only; bounded graph).
- Typed links are directional: link from the current note to what it uses/depends_on/part_of/implements/see_also; do not add reciprocal links unless explicitly requested.
- If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.

### Structure + validation

- Use `get_vault_tree` when you need a filesystem folder tree for the vault.
- Use `frontmatter_validate` when you need to audit frontmatter health (required keys + `id`/`created` consistency).
- Use `find_broken_links` when you need to detect unresolved wikilinks/typed links after moves/renames.
- Use `find_typed_link_backrefs` when you need incoming edges/backrefs for a target.

### Safe edits (explicit apply only)

- Prefer `apply=false` first to preview changes.
- For new notes, prefer `capture_note` so required frontmatter keys exist and `id` matches `created`.
  - When capturing, set non-default frontmatter via `frontmatter` overrides (at least `entity`/`layer`/`status`/`summary` when known).
  - Prefer reusing existing `tags`/`keywords` by checking `list_tags` / `list_keywords` first (avoid near-duplicates).
- Default policy for `capture_note` / `edit_note` / `improve_frontmatter`: do `apply=false` preview, then proceed with `apply=true` automatically (auto-apply).
  - Only pause when the user explicitly requests “preview only” or the preview indicates a suspicious target.
- Do not override identity fields (`id`, `created`) unless the user explicitly asks.
- For line-based edits, fetch the note via `read_note`, then compute exact anchors + line numbers (do not guess).
- Use `expected_sha256` to avoid overwriting concurrent edits.
- Only set `apply=true` after confirming the target path + patch ops are correct.
- Update frontmatter `updated` as part of the same edit operation (avoid “content changed but updated not bumped” drift).
- After `apply=true`, confirm `reindex_summary` so the DB stays consistent.

### Frontmatter quick reference (avoid inventing new enum values)

- Required keys (minimum): `id`, `created`, `title`, `summary`, `aliases`, `entity`, `layer`, `tags`, `keywords`, `status`, `updated`, `source`
- Formats:
  - `id` must be 14 digits (`YYYYMMDDHHmmss`) and match the first 14 digits of `created` (`YYYY-MM-DDTHH:mm:ss`)
  - `source` is always an array (example: `source: []`)
- `layer`: `strategic` | `conceptual` | `logical` | `physical` | `operational`
- `status`: `draft` | `in-review` | `active` | `archived`
- Typed-link keys (only include when non-empty; omit key when you have no values): `instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `see_also`, `cites`, `authored_by`, `supersedes`, `same_as`
- `entity` candidates (use one of these; do not invent new values):
  - `concept` | `document` | `project` | `artifact` | `person` | `organization` | `place` | `event` | `task` | `method` | `tool` | `idea` | `principle` | `heuristic` | `pattern` | `definition` | `question` | `software` | `dataset` | `pipeline` | `procedure` | `dashboard` | `checklist` | `workflow` | `decide` | `review` | `plan` | `implement` | `approve` | `reject` | `observe` | `measure` | `test` | `verify` | `learn` | `research` | `summarize` | `publish` | `meet` | `audit` | `deploy` | `rollback` | `refactor` | `design` | `delete` | `update` | `create` | `schedule` | `migrate` | `reference` | `hub` | `interface` | `guide` | `log` | `structure` | `architecture` | `analyze`
- External vs internal sources:
  - Use `source: ['https://…']` for external URLs/docs/tickets
  - Use `cites` for citations to other vault notes (example below)

```yaml
cites: ["[[Some Note]]"]
```

## Tool availability (important)

- Read tools are always registered.
- Write tools are **not** registered by default. They require `AILSS_ENABLE_WRITE_TOOLS=1`.
- If a write tool is missing, do not “simulate” a write. Ask the user to enable write tools or proceed read-only.

## Obsidian grammar (titles + links)

- Titles are filenames: keep them cross-device safe (especially for Sync).
  - Avoid: `\\` `/` `:` `*` `?` `"` `<` `>` `|` `#` `^` and `%%` / Obsidian wikilink brackets.
  - Prefer using only letters/numbers/spaces plus `-` and `_` when in doubt.
- Default to English titles. Avoid translation parentheses (e.g. `Korean(English)`); use frontmatter `aliases` for translations/alternate titles instead.
- If you need the full path in a wikilink (disambiguation), hide it with display text:
  - Example below

```md
[[20. Areas/50. AILSS/20. Operations/20. Operations|20. Operations]]
```

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
