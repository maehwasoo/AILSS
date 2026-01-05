# AILSS Obsidian Plugin (`ailss-obsidian`)

This plugin provides an Obsidian UI for AILSS semantic search and recommendations.

Current MVP:

- Command + ribbon icon to open **AILSS semantic search**
- Modal UI to query the AILSS index
- Results list that opens the selected note
- Command to reindex the vault (writes `<Vault>/.ailss/index.sqlite`)

The plugin is **desktop-only** right now because it spawns a local MCP server process (stdio).

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

- **OpenAI API key**: required for query embeddings
- **MCP command/args**: how to run the AILSS MCP server (stdio)
    - Example for monorepo dev:
        - command: `node`
        - args: `/absolute/path/to/Ailss-project/packages/mcp/dist/stdio.js`
- **Indexer command/args**: enables `AILSS: Reindex vault` and auto indexing
    - Example for monorepo dev:
        - command: `node`
        - args: `/absolute/path/to/Ailss-project/packages/indexer/dist/cli.js`

## Commands

- `AILSS: Semantic search`: opens the search modal
- `AILSS: Reindex vault`: runs the indexer to update `<Vault>/.ailss/index.sqlite`
