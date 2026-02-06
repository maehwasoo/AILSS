# AILSS Obsidian Plugin (`ailss-obsidian`)

This plugin manages AILSS indexing and hosts a localhost MCP service for Codex.

Current MVP:

- Command to reindex the vault (writes `<Vault>/.ailss/index.sqlite`)
- Status bar items + modals for indexer/service status
- Optional localhost MCP service for Codex (streamable HTTP; URL + token)

The plugin is **desktop-only** right now because it spawns local Node processes (indexer + MCP server/service).

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

- **OpenAI API key**: required for indexing and MCP query embeddings
- **Top K**: default `get_context.top_k` when the caller omits `top_k` (Codex)
- If installed from GitHub Release:
    - keep `MCP args` and `Indexer args` empty to use bundled scripts
- **MCP command/args**: how to run the AILSS MCP server (stdio)
    - Example for source-build install:
        - command: `node`
        - args: `/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js`
- **MCP service (Codex, localhost)**: optional localhost service (`http://127.0.0.1:<port>/mcp`)
    - Enable the service, generate a token, and use “Copy config block” to paste into `~/.codex/config.toml`
- **Indexer command/args**: enables `AILSS: Reindex vault` and auto indexing
    - Example for source-build install:
        - command: `node`
        - args: `/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js`
- If you see `spawn node ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute Node path (run `which node` on macOS/Linux, or `where node` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (1536 vs 3072) or the DB gets into a bad state; use **Indexer logs** to find which file failed.

## Commands

- `AILSS: Reindex vault`: runs the indexer to update `<Vault>/.ailss/index.sqlite`
- `AILSS: Indexing status`: shows indexing progress + last successful indexing time

The plugin also adds status bar items that show indexing progress (and last success time) and the MCP service status (click for details + one-click restart).
Times shown in the UI are displayed in your system timezone (local time).
