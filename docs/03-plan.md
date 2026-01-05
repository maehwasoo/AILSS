# Implementation plan

This document lists an implementation sequence that starts small and then expands.
It also records a few **hard decisions** so code and docs stay consistent.

## 0) Confirm assumptions / decisions

- Support scope: **desktop-first** (Codex CLI + Obsidian desktop). Mobile support is out of scope for now.
- Write scope: **recommendation-first**, with **explicit write tools** only when the user triggers an apply action.
  - Default write destination for “job done / capture” notes: `<vault>/100. Inbox/`
  - No auto-classification into other folders yet (triage later per vault rules).
- Vault path: the vault is **external** and provided via configuration (e.g., `AILSS_VAULT_PATH`).

## Current status

- Indexer MVP exists (`packages/indexer`)
- MCP server MVP exists (`packages/mcp`)
  - Read tools: `semantic_search`, `get_note`, `get_note_meta`, `search_notes`, `find_notes_by_typed_link`
- Obsidian plugin MVP exists (`packages/obsidian-plugin`)
  - UI: semantic search modal that opens a selected note

## 1) Design the index schema

- File level: `path`, `mtime`, `size`, `hash`
- Chunk level: `chunk_id`, `start/end`, `heading`, `text`, `embedding`
- Links: outgoing/incoming, type

## 2) Indexer MVP

- Markdown parsing + heading-based chunking
- Incremental updates based on file hash
- SQLite storage (including vector index via `sqlite-vec`)
- Store normalized frontmatter + typed links for structured queries

## 3) MCP server MVP

- Provide `semantic_search` (topK) + `get_note`
- Provide metadata + relation queries over indexed frontmatter (`get_note_meta`, `search_notes`, `find_notes_by_typed_link`)
- Include explanations in results (chunk path/heading/snippet)

## 4) Obsidian plugin MVP (UI)

- Recommendation list UI
- Keep “Apply” disabled at first, or limit it to calling existing scripts

## 5) Obsidian-managed indexing (background)

Goal:

- When Obsidian is running and the plugin is enabled, keep the local index DB reasonably up to date without requiring a separate manual “run indexer” step.

UX target (Smart Connections-style):

- Install + enable → indexing starts automatically in the background (after OpenAI API key is configured).
- No separate CLI step for day-to-day usage (manual “Reindex now” remains as a fallback).
- A visible status surface (status bar / modal) replaces spammy notifications:
  - “initial indexing complete”
  - “indexing in progress”
  - “exclusions blocked indexing for some paths”
- Pause/resume: allow freezing UI updates while keeping results visible (separate from indexing).

Recommended approach (desktop-first):

- The plugin spawns and manages local Node processes:
  - Indexer process (updates the local DB incrementally)
  - MCP server process (serves queries over stdio)
- Trigger indexing on:
  - Obsidian startup (optional)
  - Vault file changes (debounced/batched)
- Provide basic UX:
  - Toggle: auto-index on/off
  - Status: “indexing / last indexed / error”
  - Manual command: “Reindex now”

Notes:

- Avoid bundling native SQLite modules into the Obsidian plugin bundle; keep them in the spawned processes.
- Watcher/index triggers must ignore vault-internal technical folders (e.g. `.obsidian`, `.trash`, `.ailss`) to avoid index loops and noisy reindexing.
- Persist generated artifacts under a dedicated vault folder (e.g. `<vault>/.ailss/`) and document recommended sync-ignore patterns (similar to how other plugins ignore their generated index folders).
- Exclusions must be user-configurable (folders/files/keywords), and blocked paths should surface as an “event” instead of silently failing.
- Embeddings are **OpenAI API-based only** for now (requires `OPENAI_API_KEY` and has usage costs).
  - Add throttling + batching to prevent runaway indexing bills on large vaults.

## 6) Next: vault-rule tools (frontmatter + typed links)

Reference docs (source of truth):

- Vault rules snapshot: `docs/vault-ref/vault-root/README.md`
- Vault working rules: `docs/vault-ref/vault-root/AGENTS.md`

MCP tools (read-only):

Implemented:

- `get_note_meta`: return normalized frontmatter + typed links from the index DB
- `search_notes`: filter notes by frontmatter-derived fields (e.g. `entity`, `layer`, `status`) plus tags/keywords
- `find_notes_by_typed_link`: find notes that point to a typed-link target (typed-link “backrefs”)

Notes on queryability (current):

- `search_notes` supports only a fixed set of frontmatter-derived filters: `entity`, `layer`, `status`, `tags`, `keywords`, plus basic path/title filters.
- Typed links are queryable via `find_notes_by_typed_link` by `rel` + `target` (target normalized from `[[wikilinks]]`).
- Other frontmatter keys are stored (normalized JSON) and visible via `get_note_meta`, but are not directly filterable yet.

Planned:

- `validate_frontmatter`: validate frontmatter against the vault schema/rules
- `search_vault`: keyword/regex search over vault files (useful when embeddings are not enough)
- `suggest_typed_links`: suggest typed-link candidates with evidence

TODO (to expand structured queries):

- Add a generic frontmatter key/value index (e.g. `note_frontmatter_kv`) and an MCP tool to filter by arbitrary keys (e.g. `created`, `updated`, `source`).
- Add date/range filters for `created` / `updated` (requires consistent formatting across the vault).

Planned MCP tools (explicit write):

- `capture_note`: create a new note with correct frontmatter in `<vault>/100. Inbox/` (default), returning the created path
  - Prefer a `dry_run`/preview option and never overwrite existing notes by default.

Safety contract (for all MCP tools that touch the vault):

- Always treat `AILSS_VAULT_PATH` as the root; deny absolute paths and prevent path traversal.
- Restrict reads/writes to markdown notes (`.md`) and ignore vault-internal/system folders (e.g. `.obsidian`, `.git`, `.trash`, `.backups`, `.ailss`, `node_modules`).
- For any write tool:
  - Require an explicit confirmation signal (e.g. `confirm_paths` that must match the final resolved paths).
  - Support `dry_run` to preview the exact path + content without writing.
  - Default: create-only (no overwrite); destructive actions require separate explicit flags.

## 7) Integration / operations

- Local config (API key, vault path)
- Privacy documentation + opt-in options
