# 0007. Obsidian plugin hosts MCP over localhost (streamable HTTP)

status: draft

## Context

- Codex CLI can run MCP servers in a filesystem sandbox (`workspace-write`).
- AILSS opens the vault-local SQLite index DB at `<vault>/.ailss/index.sqlite` in **WAL mode**.
  - WAL mode requires sidecar files (`index.sqlite-wal`, `index.sqlite-shm`) next to the DB.
- When Codex spawns the `ailss` MCP server as a child process, the server can crash during startup if it cannot write those WAL sidecar files (Codex reports a generic MCP handshake failure).
- We also want Codex usage to be **read-only** for note files, with note changes applied via explicit user action inside Obsidian.

## Decision

Shift the Codex integration boundary:

- The Obsidian plugin becomes the **host** of the AILSS MCP service.
  - The plugin starts and supervises a local Node process that opens the vault DB and reads vault files.
  - The service exposes MCP over **streamable HTTP** (SSE + HTTP POST) and binds to `127.0.0.1` only.
  - The service registers **read-only** MCP tools only (no vault file write tools exposed to Codex).
- Codex connects to the plugin-hosted MCP server via `url = "http://127.0.0.1:<port>/<path>"`.
  - Codex no longer needs vault filesystem permissions.
  - Codex no longer needs to manage WAL sidecar write access.
- Note edits are applied in Obsidian:
  - Codex produces “suggested ops” (line-based patch ops + expected sha256).
  - The Obsidian plugin previews and applies them via the Vault API, then triggers a path-scoped reindex.

## Consequences

- Pros
  - Eliminates Codex sandbox friction for vault DB WAL sidecars
  - Keeps Codex read-only for vault files by default (lower blast radius)
  - Centralizes indexing + DB lifecycle under the plugin (more predictable UX)
- Cons / risks
  - Requires a long-lived local service process (lifecycle, restarts, logs)
  - Needs authentication even on localhost (token handling)
  - Requires a Codex MCP client configuration that supports remote MCP over HTTP

## Alternatives

- Keep Codex spawning the MCP server (stdio) and grant vault write permissions for `<vault>/.ailss/`
  - Simpler wiring, but higher friction/risk and still sensitive to sandbox config
- Export a read-only DB snapshot into the workspace for Codex to query
  - Avoids vault writes for Codex, but introduces sync/staleness and copy costs
- Run a separate long-lived daemon outside Obsidian
  - Similar benefits to this decision, but adds more ops surface for personal/local usage
