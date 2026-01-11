# Implementation plan

This document lists an implementation sequence that starts small and then expands.
It also records a few **hard decisions** so code and docs stay consistent.

## 0) Confirm assumptions / decisions

- Support scope: **desktop-first** (Codex CLI + Obsidian desktop). Mobile support is out of scope for now.
- Write scope: **recommendation-first**, with **explicit write tools** only when the user triggers an apply action.
  - Default write destination for “job done / capture” notes: `<vault>/100. Inbox/`
  - No auto-classification into other folders yet (triage later per vault rules).
- Codex integration: Codex should not need vault filesystem permissions.
  - Codex connects to AILSS via a **plugin-hosted MCP server over localhost** (streamable HTTP).
  - Codex can trigger explicit write tools over MCP (no per-edit UI flow) once enabled.
  - Connection is configured globally once (e.g. `~/.codex/config.toml`) via a URL + token.
- Vault path: the vault is **external** and provided via configuration (e.g., `AILSS_VAULT_PATH`).

## Current status

- Indexer MVP exists (`packages/indexer`)
  - Supports full-vault indexing and path-scoped updates (`--paths`)
  - Supports explicit DB reset (`--reset-db`) when switching embedding models
  - Validates DB embedding identity (model/dimension) and fails fast on mismatch
  - Full-vault runs prune DB entries for deleted files
  - Has a deterministic wrapper test (stubbed embeddings; no network)
- MCP server MVP exists (`packages/mcp`)
  - Read-first tools: `get_context`, `get_typed_links`, `find_typed_link_backrefs`, `resolve_note`, `read_note`, `get_vault_tree`, `frontmatter_validate`, `find_broken_links`, `search_notes`, `list_tags`, `list_keywords`, `suggest_typed_links`
  - Explicit write tools (gated; `AILSS_ENABLE_WRITE_TOOLS=1`): `capture_note`, `edit_note`, `improve_frontmatter`, `relocate_note`
  - Transport: stdio + streamable HTTP (`/mcp` on localhost; supports multiple concurrent sessions)
- Obsidian plugin MVP exists (`packages/obsidian-plugin`)
  - UI: semantic search modal that opens a selected note
  - Indexing: `AILSS: Reindex vault` command + optional auto-index on file changes (debounced; spawns the indexer process)
  - MCP service: optional localhost MCP server for Codex (URL + token; can expose gated write tools)
    - Supports multiple concurrent MCP sessions (multiple Codex processes)

## 1) Design the index schema

- File level: `path`, `mtime`, `size`, `hash`
- Chunk level: `chunk_id`, `path`, `heading`, `heading_path_json`, `content`, `content_sha256`, `embedding`
- Links: outgoing/incoming, type

## 2) Indexer MVP

- Markdown parsing + heading-based chunking
- Incremental updates based on file hash
- SQLite storage (including vector index via `sqlite-vec`)
- Store normalized frontmatter + typed links for structured queries

## 3) MCP server MVP

- Provide `get_context` (semantic retrieval) + `read_note` (exact note text)
- Provide `get_typed_links` for typed-link navigation from a note path (outgoing only; bounded graph)
- Include enough evidence in results (note path + snippet + optional preview)

## 4) Obsidian plugin MVP (UI)

- Semantic search modal UI (opens the selected note)
- Keep “Apply” disabled at first, or limit it to calling existing scripts

## 5) Obsidian-managed indexing (background)

Goal:

- When Obsidian is running and the plugin is enabled, keep the local index DB reasonably up to date without requiring a separate manual “run indexer” step.

UX target (Smart Connections-style):

- Install + enable → indexing can run automatically in the background (after OpenAI API key is configured and auto indexing is explicitly enabled).
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

- Vault rules (frontmatter schema + typed links + assistant workflow): `docs/standards/vault/README.md`

MCP tools (read-only):

Implemented:

- `get_context`: semantic retrieval for a query → returns top matching notes (deduped by path) with snippets and optional previews
- `get_typed_links`: expand outgoing typed links from a specified note path into a bounded graph (DB-backed; metadata only)
- `find_typed_link_backrefs`: find notes that reference a target via typed links (incoming edges; includes `links_to`)
- `resolve_note`: resolve an id/title/wikilink target to candidate note paths (DB-backed; intended before `read_note`/`edit_note`)
- `read_note`: read a vault note by path → return raw note text (may be truncated; requires `AILSS_VAULT_PATH`)
- `get_vault_tree`: folder tree view of vault markdown files (filesystem-backed; requires `AILSS_VAULT_PATH`)
- `frontmatter_validate`: scan vault notes and validate required frontmatter key presence + `id`/`created` consistency
- `find_broken_links`: detect broken wikilinks/typed links by resolving targets against indexed notes (DB-backed)
- `search_notes`: search indexed note metadata (frontmatter-derived fields, tags/keywords/sources) without embeddings
- `list_tags`: list indexed tags with usage counts
- `list_keywords`: list indexed keywords with usage counts
- `suggest_typed_links`: suggest frontmatter typed-link candidates using already-indexed body wikilinks (DB-backed)

Notes on queryability (current):

- AILSS stores normalized frontmatter + typed links in SQLite (used for graph expansion and retrieval).
- The MCP surface supports both semantic retrieval (`get_context`) and structured navigation/filtering (`get_typed_links`, `find_typed_link_backrefs`, `search_notes`).
- Frontmatter normalization coerces YAML-inferred scalars (unquoted numbers/dates) to strings for core identity fields (`id`, `created`, `updated`) so existing vault notes can remain unquoted.

Planned:

- Extend `frontmatter_validate` to validate the full vault schema/rules (types, allowed values) beyond required-key presence and `id`/`created` consistency.

TODO (to expand structured queries):

- Add a generic frontmatter key/value index (e.g. `note_frontmatter_kv`) and an MCP tool to filter by arbitrary keys (e.g. `created`, `updated`).
- Add date/range filters for `created` / `updated` (requires consistent formatting across the vault).

Write tools (explicit apply):

- `capture_note`: create a new note in `<vault>/100. Inbox/` (default) with full frontmatter (gated; requires `AILSS_ENABLE_WRITE_TOOLS=1`)
  - Supports `apply=false` dry-run (preview) and never overwrites existing notes by default
  - By default reindexes the created path (set `reindex_after_apply=false` to skip)
- `edit_note`: apply line-based patch ops to an existing `.md` note (gated; requires `AILSS_ENABLE_WRITE_TOOLS=1`)
  - Supports `apply=false` dry-run (preview); line numbers are 1-based; append via `insert_lines` at `lineCount+1`
  - Optional `expected_sha256` guard; by default reindexes the edited path (set `reindex_after_apply=false` to skip)
- `relocate_note`: move/rename a note within the vault (gated; requires `AILSS_ENABLE_WRITE_TOOLS=1`)
  - Supports `apply=false` dry-run, optional overwrite, and optional reindex
  - Updates frontmatter `updated` when a frontmatter block is present
  - Does not update inbound references (future enhancement)
- `improve_frontmatter`: normalize/add required frontmatter keys for a note (gated; requires `AILSS_ENABLE_WRITE_TOOLS=1`)
  - Supports `apply=false` dry-run (preview) and optional `expected_sha256` guard
  - By default reindexes the edited path (set `reindex_after_apply=false` to skip); optional `fix_identity=true` can repair id/created mismatches

Safety contract (for all MCP tools that touch the vault):

- Always treat `AILSS_VAULT_PATH` as the root; deny absolute paths and prevent path traversal.
- Restrict reads/writes to markdown notes (`.md`) and ignore vault-internal/system folders (e.g. `.obsidian`, `.git`, `.trash`, `.backups`, `.ailss`, `node_modules`).
- For any write tool:
  - Default `apply=false` (preview only); no write occurs unless `apply=true`.
  - Prefer an `expected_sha256` guard when modifying existing notes (when supported by the tool).
  - Default: create-only / no overwrite; destructive actions require explicit flags (e.g. overwrite).

## 7) Integration / operations

- Local config (API key, vault path)
- Privacy documentation + opt-in options

## 8) Production readiness (personal daily use)

Goal:

- Make the system reliable for daily use on a single machine (Obsidian desktop + Codex CLI).

Plan:

- Plugin-managed **long-lived MCP process** (avoid spawn-per-search latency; restart on crash; stop on unload)
- Indexer **single-writer lock** (prevent concurrent indexing from plugin/CLI)
- DB **identity + validation** (embedding model/dimension now; schema version later)

## 9) Production readiness (public distribution)

Goal:

- Make installation and upgrades predictable for other users.

Plan:

- Packaging: publish release artifacts for the Obsidian plugin (and document supported Obsidian versions)
- DX: make the MCP server runnable like `npx … --vault <path>` (CLI args + published package/wrapper)
- Upgrades: document schema/model change behavior (when a full reindex is required)

## 10) Codex integration via plugin-hosted MCP service (localhost)

Goal:

- Make Codex work with AILSS **without** any vault filesystem permissions in Codex.
- Let Codex trigger explicit vault writes over MCP (good UX), while keeping the service localhost-only.

Non-goals:

- No “remote over the internet” server; this is localhost-only.

### 10.1 High-level architecture

- Obsidian plugin starts and supervises a local Node process (“AILSS service”) that:
  - opens `<vault>/.ailss/index.sqlite` in WAL mode
  - reads vault files (for tools like `read_note`)
  - exposes MCP over **streamable HTTP** (SSE + HTTP POST) bound to `127.0.0.1`
  - exposes read-first tools and (when enabled) explicit write tools
- Codex connects to that service using a remote MCP configuration (`url = http://127.0.0.1:<port>/<path>`).
  - Codex is configured globally once (via `~/.codex/config.toml`) using the URL + token.

### 10.2 Security + safety requirements

- Bind address: `127.0.0.1` only (no LAN access by default).
- Auth: require a per-vault token (Bearer token or equivalent).
  - Token stored in Obsidian plugin settings
  - Provide a “Copy Codex config block” UI in the plugin (for `~/.codex/config.toml`)
- Write tools must remain explicitly gated:
  - Plugin toggle: “Enable write tools over MCP”
  - All write tools must support `apply=false` by default and require explicit `apply=true`
  - Recommend an `expected_sha256` guard for concurrency safety

### 10.3 Implementation plan (phased)

Phase 0 — docs + contracts (no code changes)

- Define the “write tool contract”:
  - tools must be safe by default (`apply=false`)
  - tools must deny path traversal and restrict to `.md`
  - tools should return `needs_reindex` when they change content

Phase 1 — add HTTP transport for the MCP server

- Status: implemented
- Add a new MCP entrypoint (in `packages/mcp`) that serves the same tools over streamable HTTP.
- Use the MCP SDK server transport for streamable HTTP (SSE + POST).
- Add minimal auth middleware (reject missing/invalid token).
- Keep stdio transport for local dev/tests.

Phase 2 — Obsidian plugin “AILSS service” lifecycle

- Status: implemented
- Add plugin settings:
  - enable/disable local service
  - port (default e.g. 31415) + bind address (fixed to 127.0.0.1)
  - token (auto-generate on first run)
- Add “Enable write tools over MCP” toggle
- Add status UI:
  - service running / stopped / error
  - “Copy Codex config block” action (global once)
  - “Restart service” action
- Start the service on plugin load if enabled; stop on unload.

Phase 3 — Codex-triggered writes over MCP (no per-edit UI)

- Status: implemented
- Expose explicit write tools over the localhost MCP server when enabled:
  - `edit_note` (apply line-based patch ops; default apply=false)
  - `capture_note` (create new note in `<vault>/100. Inbox/` by default)
  - `relocate_note` (move/rename a note; updates frontmatter `updated` when present)
  - `improve_frontmatter` (normalize/add required frontmatter keys)
- Ensure write tools trigger a path-scoped reindex after apply (or queue an index update).

Phase 4 — Codex setup UX

- Status: implemented
- Provide a plugin UI that outputs a ready-to-paste `~/.codex/config.toml` block.
- Troubleshooting: if MCP fails, check service running + token + port.

### 10.4 Acceptance criteria

- With Obsidian running and the service enabled, Codex can call `get_context` successfully without any `writable_roots` configuration for the vault.
- With write tools enabled, Codex can call `edit_note` with `apply=true`, and the index DB is updated for that path.

### 10.5 Multi-session support (true simultaneous Codex sessions)

Goal:

- Allow **multiple Codex CLI processes** to connect to the same Obsidian-hosted AILSS service concurrently.
- Each Codex process gets its own `Mcp-Session-Id` and can call tools without disconnecting other sessions.

Status (implemented):

- Implemented in `packages/mcp/src/httpServer.ts` using a session manager that creates one server + transport per `initialize`.
- Defaults:
  - `AILSS_MCP_HTTP_MAX_SESSIONS=5`
  - `AILSS_MCP_HTTP_IDLE_TTL_MS=3600000` (1 hour)

Why this needs explicit design:

- The SDK `StreamableHTTPServerTransport` is **stateful**: one transport instance supports **one initialized session**.
- The transport maps JSON-RPC `id` → response stream internally; sharing a single transport across clients risks **ID collisions** (many clients start IDs at `1`).

Implementation approach (preferred): in-process session manager

- Add an HTTP “session manager” to the MCP HTTP entrypoint (`packages/mcp/src/httpServer.ts`):
  - Maintain `Map<string, Session>` keyed by `mcp-session-id`.
  - On `POST initialize`:
    - Create a **new** `StreamableHTTPServerTransport({ sessionIdGenerator, onsessioninitialized, onsessionclosed })`.
    - Create a **new** `McpServer` instance, register tools/prompts, and connect it to that transport.
    - Let the transport generate the session ID; then register `{ transport, server }` in the session map.
  - On all other requests (POST/GET/DELETE):
    - Route by `mcp-session-id` header to the matching transport.
    - Unknown session → 404 “Session not found” (consistent with SDK behavior).
  - Session close:
    - On `onsessionclosed`, remove the session from the map and close the server/transport.

Shared resource strategy (required for correctness + performance):

- Create shared runtime dependencies once per service process (DB + OpenAI client) and reuse across sessions.
  - `createAilssMcpRuntimeFromEnv()` opens the DB and creates the OpenAI client once.
  - `createAilssMcpServerFromRuntime(runtime)` registers tools on a new `McpServer` while reusing `runtime.deps`.
  - This avoids opening multiple SQLite connections to the same WAL DB and avoids repeated sqlite-vec extension loads.

Concurrency / safety contract (must be explicit):

- Reads can run concurrently across sessions (subject to Node single-thread scheduling).
- Writes must be serialized to avoid races:
  - Implement a global async “write queue” (a simple mutex) for vault write tools (e.g. `edit_note`, `capture_note`, `relocate_note`).
  - Optional follow-up: file-level locks so edits to different notes can proceed safely in parallel.
- Keep a hard cap on active sessions (e.g. `maxSessions = 5`) and an idle timeout (e.g. `idleTtlMs = 15m`) to prevent leaks.

Verification criteria (done when):

- Two concurrent Codex processes can both:
  - complete MCP initialize successfully
  - call `tools/list` and a read tool (e.g. `get_context`) without disconnecting each other
- Session termination (`DELETE`) removes the session from the map and releases resources.

Fallback approach (acceptable, higher overhead): per-session subprocess

- Spawn a dedicated `ailss-mcp-http` process per Codex session (one port per session, or a reverse proxy that pins one upstream per client).
- Pros: strongest isolation, simplest correctness story.
- Cons: more processes, more ports, more restart surface.
