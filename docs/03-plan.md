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
  - Read tools: `semantic_search`, `get_note`
- Obsidian plugin MVP exists (`packages/obsidian-plugin`)
  - UI: semantic search modal that opens a selected note

## 1) Design the index schema

- File level: `path`, `mtime`, `size`, `hash`
- Chunk level: `chunk_id`, `start/end`, `heading`, `text`, `embedding`
- Links: outgoing/incoming, type

## 2) Indexer MVP

- Markdown parsing + heading-based chunking
- Incremental updates based on file hash
- SQLite storage (vector index to be added later)

## 3) MCP server MVP

- Provide `semantic_search` (topK) + `get_note`
- Include explanations in results (chunk path/heading/snippet)

## 4) Obsidian plugin MVP (UI)

- Recommendation list UI
- Keep “Apply” disabled at first, or limit it to calling existing scripts

## 5) Obsidian-managed indexing (background)

Goal:

- When Obsidian is running and the plugin is enabled, keep the local index DB reasonably up to date without requiring a separate manual “run indexer” step.

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

## 6) Next: vault-rule tools (frontmatter + typed links)

Reference docs (source of truth):

- Vault rules snapshot: `docs/vault-ref/vault-root/README.md`
- Vault working rules: `docs/vault-ref/vault-root/AGENTS.md`

Planned MCP tools (read-only):

- `get_note_meta`: parse frontmatter and return derived metadata (title, tags, typed links, etc.)
- `validate_frontmatter`: validate frontmatter against the vault schema/rules
- `search_vault`: keyword/regex search (useful when embeddings are not enough)
- `suggest_typed_links`: suggest typed-link candidates with evidence

Planned MCP tools (explicit write):

- `capture_note`: create a new note with correct frontmatter in `<vault>/100. Inbox/` (default), returning the created path
  - Prefer a `dry_run`/preview option and never overwrite existing notes by default.

## 7) Integration / operations

- Local config (API key, vault path)
- Privacy documentation + opt-in options
