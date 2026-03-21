# AILSS Obsidian Plugin (`ailss-obsidian`)

This plugin keeps Obsidian as the local UX shell while centering the runtime around the
Python service app in `apps/api`. It manages the Python backend, the Python indexer, and
the localhost Python MCP service for the current desktop workflow.

Current MVP:

- Local Python backend lifecycle for health, retrieval, grounded agent runs, and evals
- Command to reindex the vault (writes `<Vault>/.ailss/index.sqlite`)
- Status bar items + modals for backend/indexer/service status
- Localhost MCP service for Codex (streamable HTTP; URL + token)

The plugin is **desktop-only** right now because it spawns local Python processes.
The Python backend, Python indexer, and Python MCP service are the supported local runtime.
See `docs/architecture/legacy-node-typescript-runtime-removal.md` for the removal record of
the retired Node runtime path.

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
uv sync --directory "<Vault>/.obsidian/plugins/ailss-obsidian/ailss-service/apps/api" --locked
```

When installed from GitHub Release, you can usually leave backend/MCP/indexer args empty and
the plugin will auto-detect bundled `apps/api` runners under `ailss-service/`.

4. Configure settings inside Obsidian

- **Python backend (local)**: this is the primary local runtime for health, retrieval,
  agent runs, and evals
- **OpenAI API key**: required for indexing and MCP query embeddings
- **Top K**: default `get_context.top_k` when the caller omits `top_k` (Codex)
- If installed from GitHub Release:
    - keep `Python backend args`, `MCP args`, and `Indexer args` empty to use bundled runners
- **MCP service (Codex, localhost)**: Python localhost service (`http://127.0.0.1:<port>/mcp`)
    - copy the token into `~/.codex/config.toml` or your Claude Code config
- **Python backend command/args**
    - Example for source-build install:
        - command: `uv`
        - args: `run --directory /absolute/path/to/AILSS-project/apps/api ailss-api`
- **MCP command/args**
    - Example for source-build install:
        - command: `uv`
        - args: `run --directory /absolute/path/to/AILSS-project/apps/api ailss-mcp-http`
- **Indexer command/args**: enables `AILSS: Reindex vault` and auto indexing
    - Example for source-build install:
        - command: `uv`
        - args: `run --directory /absolute/path/to/AILSS-project/apps/api ailss-indexer`
- If you see `spawn uv ENOENT`: Obsidian may not inherit your shell `PATH` (especially on macOS). Set the command to your absolute `uv` path (run `which uv` on macOS/Linux, or `where uv` on Windows).
- Index maintenance: use **Reset index DB** if you switch embedding models (1536 vs 3072) or the DB gets into a bad state; use **Indexer logs** to find which file failed.

## Commands

- `AILSS: Reindex vault`: runs the indexer to update `<Vault>/.ailss/index.sqlite`
- `AILSS: Indexing status`: shows indexing progress + last successful indexing time
- `AILSS: Python backend status`: shows the primary local runtime status and troubleshooting actions

The plugin also adds status bar items that show the Python backend status, indexing progress
(and last success time), and the MCP service status.
Times shown in the UI are displayed in your system timezone (local time).
