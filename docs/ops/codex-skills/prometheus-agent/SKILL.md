---
name: ailss-prometheus-agent
description: Retrieval-first AILSS vault workflow for Codex CLI (MCP read tools first; explicit gated writes)
mcp_tools:
  # Always available (read tools)
  - get_context
  - get_typed_links
  - read_note
  - get_vault_tree
  - frontmatter_validate
  - find_broken_links
  - suggest_typed_links
  - sequentialthinking_hydrate
  # Only when write tools are enabled (AILSS_ENABLE_WRITE_TOOLS=1)
  - sequentialthinking
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
3. Use `read_note` to confirm exact wording and frontmatter before making claims.

## Sequential thinking (planning discipline)

- Required:
  - Start every request by calling `sequentialthinking` to break the work into steps and verification criteria.
  - Do not execute (especially any write) until `nextThoughtNeeded=false`.
  - Once `nextThoughtNeeded=false` and no additional user confirmation is required, proceed immediately to the execution step in the same turn.
  - Before any phase change (plan → execute, execute → verify), call `sequentialthinking` again and reach `nextThoughtNeeded=false` before continuing.

## Tool availability (important)

- Read tools are always registered.
- Write tools are **not** registered by default. They require `AILSS_ENABLE_WRITE_TOOLS=1`.
- If a write tool is missing, do not “simulate” a write. Ask the user to enable write tools or proceed read-only.

## Safe writes (when enabled)

- Prefer `apply=false` first (dry-run), then confirm with the user, then `apply=true`.
- For edits, use `expected_sha256` to avoid overwriting concurrent changes.
- Keep identity fields safe: do not override `id`/`created` unless the user explicitly requests it.

## Common recipes

### Create a new note (`capture_note`)

1. Run `get_context` with the intended topic/title to avoid duplicates and reuse existing naming.
2. Draft a new note (title, optional summary, optional tags/keywords).
3. Call `capture_note` with `apply=false` to preview the resulting path + sha256.
4. Confirm with the user.
5. Call `capture_note` again with `apply=true`.

Notes:

- Let `capture_note` generate `id`/`created`/`updated` unless the user explicitly wants overrides.
- Typed links are optional; if you include typed links, only include keys that have values.

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
