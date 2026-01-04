# Local development

This document describes how to run the indexer and MCP server locally.

## 1) Environment variables

Create a `.env` at the repo root based on `.env.example`, and set:

- `OPENAI_API_KEY`
- `AILSS_VAULT_PATH` (absolute path)
- `OPENAI_EMBEDDING_MODEL` (optional; default: `text-embedding-3-small`)

## 2) Install / build

> This project may require building the native `better-sqlite3` module.  
> In sandbox/CI environments, default cache paths may be blocked, so pin caches inside the workspace.

```bash
CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile
pnpm build
```

## 3) Run indexing

```bash
pnpm -C packages/indexer start -- --vault "$AILSS_VAULT_PATH"
```

Options:

- `--max-chars 4000`: max chunk size (characters)
- `--batch-size 32`: embedding request batch size

## 4) Run MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```

Required:

- `OPENAI_API_KEY` (for query embeddings)
- `AILSS_VAULT_PATH` (to resolve the default DB path, and to read files for `get_note`)

## 5) Quality checks

During development, these commands are used frequently:

- Full check: `pnpm check`
- Format: `pnpm format` / `pnpm format:check`
- Lint: `pnpm lint` / `pnpm lint:fix`
- Test: `pnpm test`

Git hooks are installed automatically via Lefthook during `pnpm install`. See `docs/standards/quality-gates.md`.
