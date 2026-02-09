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

- `get_context`: semantic retrieval for a query → returns top matching notes (deduped by path) with note metadata and stitched evidence chunks
  - Default `top_k` can be set via `AILSS_GET_CONTEXT_DEFAULT_TOP_K` (applies only when the caller omits `top_k`; clamped to 1–50; default: 10)
  - Returns note metadata + stitched evidence chunks by default (file-start previews are disabled unless explicitly enabled)
  - Default `max_chars_per_note` is 800 (applies only when the caller omits it; clamped to 200–50,000; used for file-start previews when enabled)
- `expand_typed_links_outgoing`: expand outgoing typed links from a specified note path into a bounded graph (DB-backed; metadata only)
- `find_typed_links_incoming`: find notes that reference a target via typed links (incoming edges)
- `resolve_note`: resolve an id/title/wikilink target to candidate note paths (DB-backed; intended before `read_note`/`edit_note`)
- `read_note`: read a vault note by path → return raw note text (may be truncated; requires `AILSS_VAULT_PATH`)
- `get_vault_tree`: folder tree view of vault markdown files (filesystem-backed)
- `frontmatter_validate`: scan vault notes and validate required frontmatter keys + `id`/`created` consistency, with typed-link ontology diagnostics (`typed_link_constraint_mode`: `off`/`warn`/`error`, default `warn`)
- `find_broken_links`: detect broken wikilinks/typed links by resolving targets against indexed notes (DB-backed)
- `search_notes`: search indexed note metadata (frontmatter-derived fields, tags/keywords/sources) without embeddings
- `list_tags`: list indexed tags with usage counts
- `list_keywords`: list indexed keywords with usage counts

Client guidance (Codex):

- For Codex CLI, steer tool usage via the vault-root prompt installer (Obsidian) and/or Codex skills (`docs/ops/codex-skills/`). Avoid per-project/workspace `AGENTS.md` prompts so guidance stays centralized and consistent.

Transport / client integration:

- Recommended: the Obsidian plugin hosts the MCP server over **localhost** (streamable HTTP), and Codex connects via a remote MCP `url`.
  - This avoids granting Codex any vault filesystem permissions.
  - The plugin remains the only writer (vault DB writes + gated note edits via MCP write tools).
  - Supports multiple concurrent MCP sessions (multiple Codex CLI processes), each with its own `Mcp-Session-Id`.
- Local dev still supports running the MCP server over stdio (CLI).
- Optional shutdown endpoint (disabled by default):
  - If `AILSS_MCP_HTTP_SHUTDOWN_TOKEN` is set (or `startAilssMcpHttpServer({ shutdown: { token } })` is used), the server exposes `POST /__ailss/shutdown`.
  - This endpoint requires the shutdown token (separate from the normal MCP request token) and shuts down the HTTP server + all MCP sessions.

Frontmatter query support (current):

- AILSS stores normalized frontmatter in SQLite for retrieval and graph building.
- The MCP surface supports both:
  - semantic retrieval via `get_context`
  - metadata filtering via `search_notes` + typed-link navigation/backrefs via `expand_typed_links_outgoing` / `find_typed_links_incoming`

Read-first tools (planned):

- TBD

Explicit write tools (apply, implemented):

- `capture_note`: capture a new inbox note with required frontmatter (default folder: `100. Inbox`; supports dry-run)
- `edit_note`: apply line-based patch ops to an existing note (supports dry-run and optional sha256 guard; reindexes by default)
  - Example: `ops: [{ op: "replace_lines", from_line: 15, to_line: 15, text: "hello world" }]`
- `improve_frontmatter`: normalize/add required frontmatter keys for a note (supports dry-run; can optionally fix identity mismatches)
- `relocate_note`: move/rename a note within the vault (supports dry-run; updates frontmatter `updated` when present)

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
