# Local development

This document describes how to run the indexer and MCP server locally.

## 1) Environment variables

Create a `.env` at the repo root based on `.env.example`, and set:

- `OPENAI_API_KEY`
- `AILSS_VAULT_PATH` (absolute path)
- `OPENAI_EMBEDDING_MODEL` (optional; default: `text-embedding-3-large`)
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

- `--model <model>`: override the embedding model for this run (default: `OPENAI_EMBEDDING_MODEL` / `text-embedding-3-large`)
  - Examples: `text-embedding-3-large`, `text-embedding-3-small`
  - `--max-chars 4000`: max chunk size (characters)
  - `--batch-size 32`: embedding request batch size
  - `--paths notes/a.md notes/b.md`: only index these vault-relative markdown paths
  - `--reset-db`: delete and recreate the DB before indexing (recommended when switching embedding models)

Note:

- The index DB records the embedding model/dimension and refuses to start on mismatch. Use `--reset-db` (or a different `--db` path) when switching models.

## 4) Run MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```

Required:

- `OPENAI_API_KEY` (for query embeddings)
- DB path configuration:
  - Recommended: `AILSS_VAULT_PATH` (derives the default DB path, and enables reading files for `read_note`)
  - Advanced: `AILSS_DB_PATH` (DB-backed tools only; `read_note` still requires `AILSS_VAULT_PATH`)

Notes:

- The index DB uses SQLite **WAL mode** (Write-Ahead Logging), which creates sidecar files next to the DB (e.g. `index.sqlite-wal` and `index.sqlite-shm`). The MCP server and indexer therefore need **write access to the DB directory**, even when only running read-only tools.
- If you run the MCP server via Codex CLI with `sandbox_mode = "workspace-write"`, you must allow writes to the vault DB directory via `sandbox_workspace_write.writable_roots`. See: [Codex CLI integration](./codex-cli.md).

Optional:

- `AILSS_ENABLE_WRITE_TOOLS=1` (enables explicit write tools like `edit_note`)
- `AILSS_GET_CONTEXT_DEFAULT_TOP_K=<n>` (sets the default `get_context.top_k` when the caller omits `top_k`; clamped to 1–50; default: 10)

### Test tools with MCP Inspector (optional)

Before wiring the MCP server into Codex CLI or the Obsidian plugin, it can be useful to call tools directly via the MCP Inspector UI.

Notes:

- The inspector will launch the STDIO server command you provide and let you call tools like `get_context` and `get_typed_links`.
- For write tools (e.g. `edit_note`), prefer `apply=false` first and only confirm/apply when you are sure the target path and patch ops are correct.

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
  - `versions.json` (release metadata; optional)

### Install (GitHub Release single archive)

If you install from GitHub Release, extract `ailss-<version>.zip` into:

- `<Vault>/.obsidian/plugins/ailss-obsidian/`

Then install service dependencies once:

```bash
cd "<Vault>/.obsidian/plugins/ailss-obsidian/ailss-service"
pnpm install --prod
```

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
- If you installed from the GitHub Release zip, the plugin bundle includes `ailss-service/` (prebuilt `core`/`mcp`/`indexer`). Install dependencies once:
  - `cd "<Vault>/.obsidian/plugins/ailss-obsidian/ailss-service" && pnpm install --prod`
  - Then you can leave **MCP/Indexer args** empty (the plugin resolves the bundled scripts automatically).
- **MCP command/args** (stdio)
  - Monorepo symlink example: command `node`, args `/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js`
  - Release archive example: command `node`, args `ailss-service/packages/mcp/dist/stdio.js`
- **Indexer command/args** (optional; enables reindex + auto-index)
  - Monorepo symlink example: command `node`, args `/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js`
  - Release archive example: command `node`, args `ailss-service/packages/indexer/dist/cli.js`
- If you see `spawn node ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute Node path (run `which node` on macOS/Linux, or `where node` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (e.g. `text-embedding-3-small` ↔ `text-embedding-3-large`); use **Indexer logs** to see which file failed.
- Command palette: `AILSS: Reindex vault`
- Optional: enable auto indexing (debounced; costs money)

## 5) Quality checks

During development, these commands are used frequently:

- Full check: `pnpm check`
- Format: `pnpm format` / `pnpm format:check`
- Lint: `pnpm lint` / `pnpm lint:fix`
- Test: `pnpm test`

Git hooks are installed automatically via Lefthook during `pnpm install`. See `docs/standards/quality-gates.md`.
