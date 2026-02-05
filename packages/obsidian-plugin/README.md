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

- Copy `main.js`, `manifest.json`, `styles.css` into:
    - `<Vault>/.obsidian/plugins/ailss-obsidian/`

Dev-friendly option (recommended while developing): symlink this folder into your vault:

```bash
# If you previously installed by copying, rename/remove the existing folder first.
ln -s /absolute/path/to/AILSS-project/packages/obsidian-plugin "<Vault>/.obsidian/plugins/ailss-obsidian"
pnpm -C packages/obsidian-plugin dev
```

Confirm: `readlink "<Vault>/.obsidian/plugins/ailss-obsidian"` should point at your repo path.

When symlinked from the monorepo, you can usually leave MCP/indexer args empty and the plugin will auto-detect `../mcp/dist/stdio.js` and `../indexer/dist/cli.js`.

4. Configure settings inside Obsidian

- **OpenAI API key**: required for indexing and MCP query embeddings
- **Top K**: default `get_context.top_k` when the caller omits `top_k` (Codex)
- **MCP command/args**: how to run the AILSS MCP server (stdio)
    - Example for monorepo dev:
        - command: `node`
        - args: `/absolute/path/to/Ailss-project/packages/mcp/dist/stdio.js`
- **MCP service (Codex, localhost)**: optional localhost service (`http://127.0.0.1:<port>/mcp`)
    - Enable the service, generate a token, and use “Copy config block” to paste into `~/.codex/config.toml`
- **Indexer command/args**: enables `AILSS: Reindex vault` and auto indexing
    - Example for monorepo dev:
        - command: `node`
        - args: `/absolute/path/to/Ailss-project/packages/indexer/dist/cli.js`
- If you see `spawn node ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute Node path (run `which node` on macOS/Linux, or `where node` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (1536 vs 3072) or the DB gets into a bad state; use **Indexer logs** to find which file failed.

## Commands

- `AILSS: Reindex vault`: runs the indexer to update `<Vault>/.ailss/index.sqlite`
- `AILSS: Indexing status`: shows indexing progress + last successful indexing time

The plugin also adds status bar items that show indexing progress (and last success time) and the MCP service status (click for details + one-click restart).
Times shown in the UI are displayed in your system timezone (local time).
