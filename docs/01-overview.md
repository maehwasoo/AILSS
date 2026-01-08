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

- `semantic_search`: embed a query → return the closest indexed chunks (snippets + distance)
- `activate_context`: seed semantic_search top1 note → expand typed-link neighbors up to 2 hops (returns previews when `AILSS_VAULT_PATH` is set, plus link evidence)
- `get_note`: read a vault note by path → return raw note text (may be truncated)
- `get_note_meta`: read from the index DB by path → return normalized frontmatter + typed links (does not read vault files)
- `search_notes`: structured DB search over frontmatter-derived fields (`note_id`, `entity`, `layer`, `status`) plus tags/keywords and path/title matching
- `find_notes_by_typed_link`: typed-link “backrefs” (which notes point to a target); target is normalized from `[[wikilinks]]`
- `search_vault`: keyword/regex search over vault files (filesystem-backed)

Server guidance:

- The MCP server exposes initialize-time instructions branded as **Prometheus Agent** (clients may use this to steer tool usage).
- The server also provides a prompt template `prometheus-agent` that instructs: “call `activate_context` first, then answer.”

Transport / client integration:

- Recommended: the Obsidian plugin hosts the MCP server over **localhost** (streamable HTTP), and Codex connects via a remote MCP `url`.
  - This avoids granting Codex any vault filesystem permissions.
  - The plugin remains the only writer (vault DB writes + gated note edits via MCP write tools).
  - Supports multiple concurrent MCP sessions (multiple Codex CLI processes), each with its own `Mcp-Session-Id`.
- Local dev still supports running the MCP server over stdio (CLI).

Frontmatter query support (current):

- Queryable via `search_notes`: `note_id` (from frontmatter `id`), `entity`, `layer`, `status`, `tags`, `keywords`, plus basic path/title filters
- Queryable via `find_notes_by_typed_link`: typed-link backrefs by `rel` + `target` (targets are normalized from `[[wikilinks]]`)
- Not yet queryable (stored and returned via `get_note_meta` only): arbitrary frontmatter keys like `created`, `updated`, `aliases`, `source`

Read-first tools (planned):

- `validate_frontmatter`: check frontmatter against the vault schema/rules
- `suggest_typed_links`: suggest typed-link candidates
- `find_broken_links`: detect broken links

Explicit write tools (apply, implemented):

- `new_note`: create a new note with full frontmatter (default: no overwrite; supports dry-run)
- `capture_note`: capture a new inbox note with full frontmatter (default folder: `100. Inbox`; supports dry-run)
- `edit_note`: apply line-based patch ops to an existing note (supports dry-run and optional sha256 guard; reindexes by default)
- `relocate_note`: move/rename a note within the vault (supports dry-run)
- `reindex_paths`: reindex specific vault paths into the DB (embeddings + metadata; supports dry-run; may incur embedding costs)

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
- Apply = file write; requires an explicit action (Obsidian UI or MCP write tool with `apply=true`, including `new_note`).
