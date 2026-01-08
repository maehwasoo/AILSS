# Codex CLI integration (MCP + sandbox)

This document explains how to run the AILSS MCP server from **Codex CLI** and avoid the common startup failure:

> `MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`

## Preferred direction (no vault filesystem permissions for Codex)

We are moving toward a setup where **Obsidian hosts the AILSS MCP server over localhost**, and Codex connects to it via a remote MCP `url`.

- Codex never opens the vault-local SQLite DB directly.
- Codex never needs vault filesystem permissions (`writable_roots`).
- The Obsidian plugin becomes the trusted boundary for:
  - DB WAL sidecar writes in `<vault>/.ailss/`
  - applying note edits via explicit MCP write tools (gated; requires `apply=true`)

See:

- Plan: `docs/03-plan.md` (section “Codex integration via plugin-hosted MCP service (localhost)”)
- ADR: `docs/adr/0007-obsidian-plugin-hosts-mcp-over-localhost.md`

If you have not enabled the plugin-hosted service yet, the legacy stdio setup below is still relevant.

## Codex setup (plugin-hosted HTTP service)

1. In Obsidian: Settings → Community plugins → **AILSS Obsidian** → enable the “MCP service (Codex, localhost)” and copy the Codex config block.

2. Paste it into `~/.codex/config.toml`. A minimal example looks like:

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

Equivalent multi-table form (same meaning):

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"

[mcp_servers.ailss.http_headers]
Authorization = "Bearer <token>"
```

## Why this happens

AILSS uses a local SQLite index DB at `<vault>/.ailss/index.sqlite`.

The DB is opened in SQLite **WAL mode** (Write-Ahead Logging), which creates sidecar files next to the DB:

- `index.sqlite-wal`
- `index.sqlite-shm`

That means the MCP server (and the indexer) need **write access to the DB directory**, even if you only call read-only tools.

Codex CLI’s `workspace-write` sandbox does **not** allow writes outside the workspace unless you explicitly allow them. When the MCP server cannot create/lock WAL sidecar files, it exits during startup, and Codex reports the handshake failure above.

## Legacy setup (Codex spawns the MCP server over stdio)

### 1) Keep write tools explicitly gated

The MCP server is **read-only by default**. Write tools like `edit_note` are registered only when:

- `AILSS_ENABLE_WRITE_TOOLS=1`

This is separate from filesystem permissions. You can grant vault write permissions and still keep tools read-only until you opt in.

### 2) Allow vault writes for the Codex sandbox

You have two choices:

#### Option A: Per-run override (no global config edits)

Start Codex with a config override:

```bash
codex -C /absolute/path/to/AILSS-project \
  -c 'sandbox_workspace_write.writable_roots=["/absolute/path/to/YourVault"]'
```

This is the lowest-friction way to keep vault write permission scoped to the sessions where you need it.

Project helper:

```bash
node scripts/codex-with-vault.mjs --vault "/absolute/path/to/YourVault"
```

#### Option B: Persistent setting (`~/.codex/config.toml`)

Add the vault path as a writable root:

```toml
[sandbox_workspace_write]
writable_roots = ["/absolute/path/to/YourVault"]
```

## Permission scoping (DB-only vs note edits)

If you plan to use note write tools (for example `edit_note`), set `writable_roots` to include the **whole vault directory**.

DB-only scoping (`<vault>/.ailss/`) is only appropriate when you want DB-backed read tools and you do **not** plan to write notes.

## Troubleshooting

If you still see the handshake failure:

1. Confirm `OPENAI_API_KEY` is available to the MCP process.
2. Confirm `AILSS_VAULT_PATH` points at the vault root (absolute path).
3. Confirm the index DB exists at `<vault>/.ailss/index.sqlite` (or run the indexer).
4. Confirm your Codex session includes `writable_roots` for the vault (or `<vault>/.ailss/` at minimum).

If you see `HTTP status client error (400 Bad Request) ... initialize`, you are likely running an older MCP service build that only supports a single initialized session.
Restart the plugin-hosted MCP service (or update/rebuild the plugin + `@ailss/mcp`) so the service supports multiple concurrent sessions.
