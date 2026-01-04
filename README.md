# AILSS (Indexer + MCP + Obsidian Plugin)

This repository is a code workspace for building three components for the Obsidian vault **AILSS**:

1. Indexer: Markdown → chunking → embeddings → local DB storage
2. MCP server: read-first search/recommendation tools
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
pnpm -C packages/indexer start -- --vault "$AILSS_VAULT_PATH"
```

4. Run MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```
