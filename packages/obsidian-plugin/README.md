# AILSS Obsidian Plugin (`ailss-obsidian`)

This plugin keeps Obsidian as the local UX shell while centering the runtime around the
Python backend. It also manages the transition indexer and optional localhost MCP service
that still support the current desktop workflow.

Current MVP:

- Local Python backend lifecycle for health, retrieval, grounded agent runs, and evals
- Command to reindex the vault (writes `<Vault>/.ailss/index.sqlite`)
- Status bar items + modals for backend/indexer/service status
- Optional localhost MCP service for Codex during the transition period (streamable HTTP; URL + token)

The plugin is **desktop-only** right now because it spawns local Python and Node processes.
The Python backend is the primary local runtime; the indexer and MCP service remain
transition components until later migration work completes.

## Setup (local dev)

1. Build AILSS packages

```bash
pnpm build
```

2. Build the plugin bundle

```bash
pnpm -C packages/obsidian-plugin build
```

3. Install into your vault

- Source build install: copy `main.js`, `manifest.json`, `styles.css` into:
    - `<Vault>/.obsidian/plugins/ailss-obsidian/`
- GitHub Release install: extract `ailss-<ver>.zip` into:
    - `<Vault>/.obsidian/plugins/ailss-obsidian/`
    - Then run:

```bash
cd "<Vault>/.obsidian/plugins/ailss-obsidian/ailss-service"
pnpm install --prod
```

When installed from GitHub Release, you can usually leave MCP/indexer args empty and the plugin will auto-detect bundled scripts under `ailss-service/`.

4. Configure settings inside Obsidian

- **Python backend (local)**: this is the primary local runtime for health, retrieval,
  agent runs, and evals
    - enable the backend first if you want the plugin to start and supervise it automatically
- **OpenAI API key**: required for indexing and MCP query embeddings
- **Top K**: default `get_context.top_k` when the caller omits `top_k` (Codex)
- If installed from GitHub Release:
    - keep `MCP args` and `Indexer args` empty to use bundled scripts
- **MCP service (Codex, localhost)**: optional transition service (`http://127.0.0.1:<port>/mcp`)
    - enable the service, generate a token, and use “Copy config block” to paste into `~/.codex/config.toml`
- **MCP command/args**: how to run the AILSS MCP server transition path (stdio)
    - Example for source-build install:
        - command: `node`
        - args: `/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js`
- **Indexer command/args**: enables `AILSS: Reindex vault` and auto indexing
    - Example for source-build install:
        - command: `node`
        - args: `/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js`
- If you see `spawn node ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute Node path (run `which node` on macOS/Linux, or `where node` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (1536 vs 3072) or the DB gets into a bad state; use **Indexer logs** to find which file failed.

## Commands

- `AILSS: Reindex vault`: runs the indexer to update `<Vault>/.ailss/index.sqlite`
- `AILSS: Indexing status`: shows indexing progress + last successful indexing time
- `AILSS: Python backend status`: shows the primary local runtime status and troubleshooting actions

The plugin also adds status bar items that show the Python backend status, indexing progress
(and last success time), and the MCP service status.
Times shown in the UI are displayed in your system timezone (local time).
