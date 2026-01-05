# AILSS Obsidian Plugin (`ailss-obsidian`)

This plugin provides an Obsidian UI for AILSS semantic search and recommendations.

Current MVP:

- Command + ribbon icon to open **AILSS semantic search**
- Modal UI to query the AILSS index
- Results list that opens the selected note

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

4. Configure settings inside Obsidian

- **OpenAI API key**: required for query embeddings
- **MCP command/args**: how to run the AILSS MCP server (stdio)
    - Example for monorepo dev:
        - command: `node`
        - args: `/absolute/path/to/Ailss-project/packages/mcp/dist/stdio.js`
