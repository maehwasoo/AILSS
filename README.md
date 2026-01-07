# AILSS (Indexer + MCP + Obsidian Plugin)

This repository is a code workspace for building three components for the Obsidian vault **AILSS**:

1. Indexer: Markdown → chunking → embeddings → local DB storage
2. MCP server: read-first search/recommendation + metadata/typed-link query tools
3. Obsidian plugin: show recommendations in UI + apply via explicit user action

> The actual Obsidian vault data may live outside this repo. This repo is primarily for code and design/ops documentation.

## Documentation

Design/context/plan docs live under `docs/`.

- [docs/README.md](docs/README.md)
- [docs/00-context.md](docs/00-context.md)
- [docs/01-overview.md](docs/01-overview.md)
- [docs/02-significance.md](docs/02-significance.md)
- [docs/03-plan.md](docs/03-plan.md)

## Folder structure

This repo is a pnpm-workspace monorepo. Packages live under `packages/`.

- `packages/core/`: shared logic (parsing/chunking/schema, etc.)
- `packages/indexer/`: batch/incremental indexing CLI
- `packages/mcp/`: MCP server (search/recommendation)
- `packages/obsidian-plugin/`: Obsidian plugin (UI/apply)

## Getting started (desktop-first)

1. Environment variables

- Create a `.env` at the repo root based on `.env.example`, and set `OPENAI_API_KEY` and `AILSS_VAULT_PATH`.

2. Install / build

```bash
# Pin cache paths inside the workspace (helps in sandbox/CI environments)
CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile
pnpm build
```

3. Run indexing

```bash
pnpm -C packages/indexer start
```

To index only specific vault-relative paths:

```bash
pnpm -C packages/indexer start -- --paths "notes/a.md" "notes/b.md"
```

This populates the local DB with:

- chunk embeddings (semantic search)
- normalized frontmatter fields + typed links (frontmatter relations like `part_of`, `depends_on`, etc.)

4. Run MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```

Implemented MCP tools include:

- `semantic_search`
- `activate_context`
- `get_note`
- `get_note_meta`
- `search_notes` (filter by frontmatter-derived fields/tags/keywords)
- `find_notes_by_typed_link` (typed-link “backrefs” by relation + target)

Frontmatter query support (current):

- Queryable via `search_notes`: `note_id` (from frontmatter `id`), `entity`, `layer`, `status`, `tags`, `keywords`, `path_prefix`, `title_query`
- Queryable via `find_notes_by_typed_link`: typed-link keys (e.g. `part_of`, `depends_on`, `instance_of`, etc.)
- Stored/returned via `get_note_meta` but not directly filterable yet: other frontmatter fields (e.g. `created`, `updated`, `aliases`, `source`)

MCP DB configuration:

- Recommended: set `AILSS_VAULT_PATH` so the server can derive the default DB path and read files for `get_note`.
- Advanced: set `AILSS_DB_PATH` to point directly to an existing DB file (DB-backed tools only; `get_note` still requires `AILSS_VAULT_PATH`).
- Note: the index DB uses SQLite **WAL mode** (Write-Ahead Logging), so the MCP server/indexer need write access to the DB directory (creates `*-wal`/`*-shm` files next to the DB).
- If you run the MCP server from Codex CLI with `sandbox_mode = "workspace-write"`, see [docs/ops/codex-cli.md](./docs/ops/codex-cli.md).
- If you plan to use note write tools (for example `edit_note`), configure the sandbox with full vault write permission (not just `<vault>/.ailss/`).

## Obsidian plugin (ailss-obsidian)

The plugin lives in `packages/obsidian-plugin/` and is currently desktop-only (it spawns a local MCP stdio server).

1. Build the plugin bundle

```bash
pnpm -C packages/obsidian-plugin build
```

2. Install into a vault for testing

Option A (manual copy): copy these files into:

- `<Vault>/.obsidian/plugins/ailss-obsidian/`
  - `main.js`
  - `manifest.json`
  - `styles.css`

Option B (dev-friendly symlink): link the plugin folder into your vault (recommended for development):

```bash
# If you previously installed by copying, rename/remove the existing folder first.
ln -s /absolute/path/to/AILSS-project/packages/obsidian-plugin "<Vault>/.obsidian/plugins/ailss-obsidian"
pnpm -C packages/obsidian-plugin dev
```

Confirm: `ls -la "<Vault>/.obsidian/plugins" | rg "ailss-obsidian"` should show a `ailss-obsidian -> /absolute/path/...` symlink.

3. Configure settings inside Obsidian

- **OpenAI API key** (required)
- **MCP command/args** (required): how to run the AILSS MCP server (stdio)
  - Example: command `node`, args `/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js`
- **Indexer command/args** (optional): enables `AILSS: Reindex vault` and auto indexing
  - Example: command `node`, args `/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js`
- If you see `spawn node ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute Node path (run `which node` on macOS/Linux, or `where node` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (1536 vs 3072); use **Indexer logs** to see which file failed.
