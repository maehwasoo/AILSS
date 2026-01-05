# Local development

This document describes how to run the indexer and MCP server locally.

## 1) Environment variables

Create a `.env` at the repo root based on `.env.example`, and set:

- `OPENAI_API_KEY`
- `AILSS_VAULT_PATH` (absolute path)
- `OPENAI_EMBEDDING_MODEL` (optional; default: `text-embedding-3-small`)
- `AILSS_DB_PATH` (optional; MCP only): absolute path to an existing DB file when `AILSS_VAULT_PATH` is not set

Notes:

- The indexer and MCP server load `.env` by searching upwards from the current working directory for the nearest `.env` file.

## 2) Install / build

> This project may require building the native `better-sqlite3` module.  
> In sandbox/CI environments, default cache paths may be blocked, so pin caches inside the workspace.

```bash
CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile
pnpm build
```

## 3) Run indexing

```bash
pnpm -C packages/indexer start
```

Options:

- `--max-chars 4000`: max chunk size (characters)
- `--batch-size 32`: embedding request batch size
- `--paths notes/a.md notes/b.md`: only index these vault-relative markdown paths

## 4) Run MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```

Required:

- `OPENAI_API_KEY` (for query embeddings)
- DB path configuration:
  - Recommended: `AILSS_VAULT_PATH` (derives the default DB path, and enables reading files for `get_note`)
  - Advanced: `AILSS_DB_PATH` (DB-backed tools only; `get_note` still requires `AILSS_VAULT_PATH`)

### Test tools with MCP Inspector (optional)

Before wiring the MCP server into Codex CLI or the Obsidian plugin, it can be useful to call tools directly via the MCP Inspector UI.

Notes:

- The inspector will launch the STDIO server command you provide and let you call tools like `semantic_search`.
- For write tools (e.g. `capture_note`), prefer `dry_run` first and only confirm/apply when you are sure the output path is correct.

Example:

```bash
# From the repo root (reads .env if present)
npx @modelcontextprotocol/inspector node packages/mcp/dist/stdio.js
```

## 5) Obsidian plugin (ailss-obsidian)

The plugin lives in `packages/obsidian-plugin/` and is currently desktop-only.

### Build

```bash
pnpm -C packages/obsidian-plugin build
```

### Install (manual)

Copy these files into:

- `<Vault>/.obsidian/plugins/ailss-obsidian/`
  - `main.js`
  - `manifest.json`
  - `styles.css`

### Install (dev-friendly symlink)

Instead of copying on every change, you can symlink the plugin folder into a test vault:

Note: if `ailss-obsidian` already exists in the vault plugins folder, rename/remove it first (symlink creation fails if the path exists).

```bash
ln -s /absolute/path/to/AILSS-project/packages/obsidian-plugin "<Vault>/.obsidian/plugins/ailss-obsidian"
pnpm -C packages/obsidian-plugin dev
```

Confirm: `readlink "<Vault>/.obsidian/plugins/ailss-obsidian"` should point at your repo path.

### Configure (inside Obsidian)

- **OpenAI API key**
- **MCP command/args** (stdio)
  - Example: command `node`, args `/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js`
- **Indexer command/args** (optional; enables reindex + auto-index)
  - Example: command `node`, args `/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js`
- Command palette: `AILSS: Reindex vault`
- Optional: enable auto indexing (debounced; costs money)

## 5) Quality checks

During development, these commands are used frequently:

- Full check: `pnpm check`
- Format: `pnpm format` / `pnpm format:check`
- Lint: `pnpm lint` / `pnpm lint:fix`
- Test: `pnpm test`

Git hooks are installed automatically via Lefthook during `pnpm install`. See `docs/standards/quality-gates.md`.
