# System overview

This document describes the full AILSS flow by splitting the system into **three parts**.

## 1) Indexer

Responsibilities:

- Read Markdown files from the vault via the file system.
- Chunk content and generate embeddings.
- Store embeddings + metadata in a local DB (e.g., SQLite).

Operational notes:

- The embedding model/dimension is treated as part of the DB’s identity. If you switch models, recreate the DB and reindex.

Output (example):

- `chunk_id`, `path`, `heading`, `front matter`, `hash`, `embedding vector`, `text`

## 2) MCP server

Responsibilities:

- Query the local DB and return search/recommendation results.
- Start with read-only tools by default.

Example tools:

Read-first tools (implemented in this repo):

- `get_context`: semantic retrieval for a query → returns top matching notes (deduped by path) with snippets and optional previews
- `get_typed_links`: expand outgoing typed links from a specified note path into a bounded graph (DB-backed; metadata only)
- `read_note`: read a vault note by path → return raw note text (may be truncated; requires `AILSS_VAULT_PATH`)
- `get_vault_tree`: folder tree view of vault markdown files (filesystem-backed)
- `frontmatter_validate`: scan vault notes and validate required frontmatter key presence + `id`/`created` consistency
- `find_broken_links`: detect broken wikilinks/typed links by resolving targets against indexed notes (DB-backed)
- `suggest_typed_links`: suggest frontmatter typed-link candidates using already-indexed body wikilinks (DB-backed)
- `sequentialthinking_hydrate`: load a sequentialthinking session note plus recent thought notes as a context bundle (DB-backed session id; vault read)

Client guidance (Codex):

- For Codex CLI, steer tool usage via workspace `AGENTS.md` and/or Codex prompt snippets (`docs/ops/codex-prompts/`).

Transport / client integration:

- Recommended: the Obsidian plugin hosts the MCP server over **localhost** (streamable HTTP), and Codex connects via a remote MCP `url`.
  - This avoids granting Codex any vault filesystem permissions.
  - The plugin remains the only writer (vault DB writes + gated note edits via MCP write tools).
  - Supports multiple concurrent MCP sessions (multiple Codex CLI processes), each with its own `Mcp-Session-Id`.
- Local dev still supports running the MCP server over stdio (CLI).

Frontmatter query support (current):

- AILSS stores normalized frontmatter in SQLite for retrieval and graph building.
- The MCP surface focuses on `get_context` (semantic retrieval) and `get_typed_links` (typed-link navigation) rather than exposing arbitrary frontmatter filtering.

Read-first tools (planned):

- TBD

Explicit write tools (apply, implemented):

- `capture_note`: capture a new inbox note with full frontmatter (default folder: `100. Inbox`; supports dry-run)
- `edit_note`: apply line-based patch ops to an existing note (supports dry-run and optional sha256 guard; reindexes by default)
- `improve_frontmatter`: normalize/add required frontmatter keys for a note (supports dry-run; can optionally fix identity mismatches)
- `relocate_note`: move/rename a note within the vault (supports dry-run; updates frontmatter `updated` when present)
- `sequentialthinking`: record a step-by-step thinking trace as linked vault notes (supports dry-run; requires `apply=true`)

Write tools (planned):

TBD

Write tools are gated and not exposed by default:

- Set `AILSS_ENABLE_WRITE_TOOLS=1` to register write tools like `edit_note` in the MCP server

## 3) Obsidian plugin

Responsibilities:

- Display recommendations in a UI.
- Keep the local index DB up to date (manual reindex and optional debounced auto-index).
- Only perform vault writes when explicitly requested (for example an MCP write tool call with `apply=true`).
- Applying changes can be implemented either via the Obsidian Vault API or via direct filesystem writes (but must remain gated and auditable).

## Data boundary

- Indexing = file read + DB write
- Recommendation = DB read
- Apply = file write; requires an explicit action (Obsidian UI or MCP write tool with `apply=true`, including `capture_note`/`edit_note`).
