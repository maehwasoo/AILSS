# MCP tools (reference)

This is a reference for the MCP tool surface exposed by AILSS.

Source of truth: `packages/mcp/src/tools/*.ts`.

## Read tools (always available)

### `get_context`

- Purpose: semantic retrieval over the index DB (returns note metadata + stitched evidence chunks; optional file-start previews).
- Input:
  - `query` (string, required)
  - `path_prefix` (string, optional) — literal vault-relative prefix match for candidate notes (not SQL wildcard semantics)
  - `tags_any` (string[], default: `[]`) — candidate notes must include at least one tag
  - `tags_all` (string[], default: `[]`) — candidate notes must include all tags
  - `top_k` (int, default: `10`, range: `1–50`)
  - `expand_top_k` (int, default: `5`, range: `0–50`) — how many of the top_k notes include stitched evidence text
  - `hit_chunks_per_note` (int, default: `2`, range: `1–5`)
  - `neighbor_window` (int, default: `1`, range: `0–3`) — stitches ±window around the best hit
  - `max_evidence_chars_per_note` (int, default: `1500`, range: `200–20,000`)
  - `include_file_preview` (boolean, default: `false`) — when true, includes file-start preview (requires `AILSS_VAULT_PATH`)
  - `max_chars_per_note` (int, default: `800`, range: `200–50,000`) — file-start preview size when `include_file_preview=true`
- Output (selected):
  - `applied_filters.path_prefix` (`string | null`) — normalized path prefix applied to candidate filtering
  - `applied_filters.tags_any` (`string[]`) — normalized ANY-tag filter applied to candidate filtering
  - `applied_filters.tags_all` (`string[]`) — normalized ALL-tag filter applied to candidate filtering

### `expand_typed_links_outgoing`

- Purpose: expand outgoing typed links into a bounded metadata graph (DB-only).
- Input:
  - `path` (string, required; vault-relative note path)
  - `max_notes` (int, default: `50`, range: `1–200`)
  - `max_edges` (int, default: `2000`, range: `1–10,000`)
  - `max_links_per_note` (int, default: `40`, range: `1–200`)
  - `max_resolutions_per_target` (int, default: `5`, range: `1–20`)

### `resolve_note`

- Purpose: resolve an id/title/wikilink target to note paths (DB-only).
- Input:
  - `query` (string, required)
  - `limit` (int, default: `20`, range: `1–200`)

### `find_typed_links_incoming`

- Purpose: find incoming typed links pointing to a target (DB-only).
- Input:
  - `rel` (string, optional; e.g. `part_of`, `cites`)
  - `to_target` (string, optional; normalized wikilink target)
  - `limit` (int, default: `100`, range: `1–1000`)

### `read_note`

- Purpose: read a vault note by path (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `path` (string, required; vault-relative markdown path)
  - `start_index` (int, default: `0`, range: `>=0`)
  - `max_chars` (int, default: `20000`, range: `200–200,000`)
- Notes:
  - Supports pagination via `start_index` + `max_chars`.
  - Returns `truncated` + `next_start_index` when more content is available.

### `get_vault_tree`

- Purpose: render a folder tree of vault markdown files (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `path_prefix` (string, optional)
  - `include_files` (boolean, default: `false`)
  - `max_depth` (int, default: `8`, range: `1–50`)
  - `max_nodes` (int, default: `2000`, range: `1–20,000`)

### `frontmatter_validate`

- Purpose: scan vault notes and validate required frontmatter keys + `id`/`created` consistency, and optionally enforce typed-link ontology constraints.
- Scope note: `path_prefix` limits which source notes are validated/count toward `ok_count` and `issue_count`, while typed-link target resolution still uses vault-wide note metadata for relation diagnostics.
- Input:
  - `path_prefix` (string, optional)
  - `max_files` (int, default: `20000`, range: `1–100,000`)
  - `typed_link_constraint_mode` (`"off" | "warn" | "error"`, default: `"warn"`)
- Output highlights:
  - `typed_link_constraint_mode`: effective mode used by the validator
  - `typed_link_diagnostic_count`: number of relation diagnostics
  - `typed_link_diagnostics`: structured diagnostics (`path`, `rel`, `target`, `reason`, `fix_hint`, `severity`)

### `find_broken_links`

- Purpose: detect unresolved (and optionally ambiguous) typed links / wikilinks via the `typed_links` table (DB-only).
- Input:
  - `treat_ambiguous_as_broken` (boolean, default: `true`)
  - `path_prefix` (string, optional)
  - `rels` (string[], optional; default: typed-link keys)
  - `max_links` (int, default: `20000`, range: `1–100,000`)
  - `max_broken` (int, default: `2000`, range: `1–10,000`)
  - `max_resolutions_per_target` (int, default: `5`, range: `1–20`)

### `search_notes`

- Purpose: search indexed note metadata (DB-only; no embeddings).
- Input (selected):
  - `path_prefix` (string, optional)
  - `title_query` (string, optional; substring match)
  - `note_id`, `entity`, `layer`, `status` (string or string[], optional)
  - `created_from`, `created_to`, `updated_from`, `updated_to` (string, optional; ISO seconds)
  - `tags_any`, `tags_all`, `keywords_any`, `sources_any` (string[], default: `[]`)
  - `order_by` (`"path" | "created" | "updated"`, default: `"path"`)
  - `order_dir` (`"asc" | "desc"`, default: `"asc"`)
  - `limit` (int, default: `50`, range: `1–500`)

### `list_tags`

- Purpose: list indexed tags with usage counts (DB-only).
- Input:
  - `limit` (int, default: `200`, range: `1–5000`)

### `list_keywords`

- Purpose: list indexed keywords with usage counts (DB-only).
- Input:
  - `limit` (int, default: `200`, range: `1–5000`)

### `get_tool_failure_report`

- Purpose: summarize structured MCP tool failure logs (JSONL) from `<vault>/.ailss/logs`.
- Input:
  - `recent_limit` (int, default: `50`, range: `1–500`) — recent events to return (newest first)
  - `top_error_limit` (int, default: `10`, range: `1–50`) — top recurring error buckets
  - `tool` (string, optional) — filter report to one tool name (e.g. `read_note`)
- Output highlights:
  - `enabled`: whether diagnostics logging is active (requires `AILSS_VAULT_PATH`)
  - `log_dir`, `log_path`: actual diagnostics file location
  - `top_error_types`: grouped counts with first/last occurrence
  - `recent_events`: per-failure metadata (`timestamp`, `tool`, `input_path`, `resolved_path`, `error`, `request_id`, `session_id`, `correlation_id`)

## Write tools (gated)

Write tools are registered only when `AILSS_ENABLE_WRITE_TOOLS=1` and they only write when `apply=true`.

### `capture_note`

- Purpose: create a new note with AILSS frontmatter (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `title` (string, required)
  - `body` (string, default: `""`)
  - `folder` (string, default: `"100. Inbox"`)
  - `frontmatter` (record, optional; overrides)
  - `apply` (boolean, default: `false`)
  - `reindex_after_apply` (boolean, default: `true`)

### `canonicalize_typed_links`

- Purpose: canonicalize frontmatter typed-link targets in a single note to deterministic vault-relative paths when resolution is unique (filesystem + DB; requires `AILSS_VAULT_PATH`).
- Input:
  - `path` (string, required)
  - `apply` (boolean, default: `false`)
  - `reindex_after_apply` (boolean, default: `true`)
- Notes:
  - Scope is frontmatter typed-link keys only (does not touch body wikilinks).
  - If a target is unresolved or ambiguous, the tool keeps it unchanged and reports it.
  - Targets containing `/` use strict vault-relative path resolution (no suffix matching).

### `edit_note`

- Purpose: apply line-based patch ops to an existing note (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `path` (string, required)
  - `ops` (array, required; `{ op: "insert_lines" | "delete_lines" | "replace_lines", ... }`)
  - `expected_sha256` (string, optional; concurrency guard)
  - `apply` (boolean, default: `false`)
  - `reindex_after_apply` (boolean, default: `true`)

### `improve_frontmatter`

- Purpose: normalize/add required frontmatter keys (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `path` (string, required)
  - `expected_sha256` (string, optional; concurrency guard)
  - `apply` (boolean, default: `false`)
  - `reindex_after_apply` (boolean, default: `true`)
  - `fix_identity` (boolean, default: `false`)

### `relocate_note`

- Purpose: move/rename a note (filesystem; requires `AILSS_VAULT_PATH`).
- Input:
  - `from_path` (string, required)
  - `to_path` (string, required)
  - `apply` (boolean, default: `false`)
  - `overwrite` (boolean, default: `false`)
  - `reindex_after_apply` (boolean, default: `true`)
