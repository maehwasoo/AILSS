# 0007. Obsidian plugin hosts MCP over localhost (streamable HTTP)

status: accepted

## Context

- Codex CLI can run MCP servers in a filesystem sandbox (`workspace-write`).
- AILSS opens the vault-local SQLite index DB at `<vault>/.ailss/index.sqlite` in **WAL mode**.
  - WAL mode requires sidecar files (`index.sqlite-wal`, `index.sqlite-shm`) next to the DB.
- When Codex spawns the `ailss` MCP server as a child process, the server can crash during startup if it cannot write those WAL sidecar files (Codex reports a generic MCP handshake failure).
- We want Codex to be able to trigger vault writes via MCP (good UX), without relying on per-edit UI confirmation flows.

## Decision

Shift the Codex integration boundary:

- The Obsidian plugin becomes the **host** of the AILSS MCP service.
  - The plugin starts and supervises a local Node process that opens the vault DB and reads vault files.
  - The service exposes MCP over **streamable HTTP** (SSE + HTTP POST) and binds to `127.0.0.1` only.
  - The service registers read-first tools and (when explicitly enabled) **write tools** such as `edit_note`.
- Codex connects to the plugin-hosted MCP server via `url = "http://127.0.0.1:<port>/<path>"`.
  - Codex no longer needs vault filesystem permissions.
  - Codex no longer needs to manage WAL sidecar write access.
- Codex is configured globally once (e.g. `~/.codex/config.toml`) to connect to the localhost MCP URL and token.

## Consequences

- Pros
  - Eliminates Codex sandbox friction for vault DB WAL sidecars
  - Good UX: Codex can apply changes directly via MCP write tools
  - Centralizes indexing + DB lifecycle under the plugin (more predictable UX)
- Cons / risks
  - Requires a long-lived local service process (lifecycle, restarts, logs)
  - Needs authentication even on localhost (token handling)
  - Requires a Codex MCP client configuration that supports remote MCP over HTTP
  - Exposing write tools increases blast radius; write tools must remain explicitly gated and auditable

## Alternatives

- Keep Codex spawning the MCP server (stdio) and grant vault write permissions for `<vault>/.ailss/`
  - Simpler wiring, but higher friction/risk and still sensitive to sandbox config
- Keep Codex read-only and apply edits via an Obsidian UI flow
  - Safer by default, but higher-friction UX for frequent edits
- Export a read-only DB snapshot into the workspace for Codex to query
  - Avoids vault writes for Codex, but introduces sync/staleness and copy costs
- Run a separate long-lived daemon outside Obsidian
  - Similar benefits to this decision, but adds more ops surface for personal/local usage
