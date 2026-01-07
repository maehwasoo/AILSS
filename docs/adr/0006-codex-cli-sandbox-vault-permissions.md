# 0006. Codex CLI sandbox permissions for vault-backed MCP

status: accepted

## Context

- AILSS is designed to be used via an MCP server from Codex CLI (stdio) and from the Obsidian plugin.
- The MCP server reads a local SQLite index DB at `<vault>/.ailss/index.sqlite`.
- The DB is opened in SQLite **WAL mode** (Write-Ahead Logging) for reliability and performance.
  - WAL mode creates sidecar files next to the DB (`index.sqlite-wal`, `index.sqlite-shm`), even for workflows that are “logically read-only”.
- Codex CLI’s `workspace-write` sandbox blocks filesystem writes outside the workspace unless explicitly allowed.
- When the MCP server is launched by Codex without vault write permissions, it can exit during startup (e.g. `SQLITE_CANTOPEN`), and Codex reports a generic MCP handshake failure.

## Decision

- Keep the default architecture:
  - Vault-local DB at `<vault>/.ailss/index.sqlite`
  - SQLite WAL mode enabled
- Require explicit Codex sandbox configuration when running against a vault-local DB:
  - Either a per-run override (`codex -c 'sandbox_workspace_write.writable_roots=[\"<vault>\"]'`)
  - Or a persistent setting in `~/.codex/config.toml` (`[sandbox_workspace_write].writable_roots = ["<vault>"]`)
- Keep write capabilities explicitly gated:
  - The MCP server remains **read-only by default**
  - Write tools (e.g. `edit_note`) require `AILSS_ENABLE_WRITE_TOOLS=1`
- Default to full-vault permission for workflows that use note write tools:
  - Set `writable_roots` to the vault root (not just `<vault>/.ailss/`)
  - Keep `AILSS_ENABLE_WRITE_TOOLS=1` as the explicit opt-in for registering write tools
- Document the configuration and failure mode in ops docs so it is discoverable during setup.

## Consequences

- Pros
  - One canonical DB location for Obsidian + Codex workflows
  - WAL mode keeps DB behavior stable under real-world usage
  - Clear separation between “filesystem permission” and “tool registration” for write operations
- Cons / risks
  - Requires an extra setup step for Codex users running with sandboxing enabled
  - Granting vault write access increases blast radius if write tools are enabled and misused

## Alternatives

- Use a workspace-local DB path when running from Codex
  - Pros: avoids sandbox configuration
  - Cons: splits the “canonical” DB; more sync/consistency complexity
- Make the MCP server open the DB in a strictly read-only mode
  - Pros: reduces write needs in some environments
  - Cons: WAL mode and schema validation/migrations still make “no writes” fragile; doesn’t help `edit_note`
- Run a long-lived MCP server outside Codex (remote transport / bridge)
  - Pros: avoids per-session sandbox friction
  - Cons: additional infrastructure and operational complexity
