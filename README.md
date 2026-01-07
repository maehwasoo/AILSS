# AILSS — connect LLMs to your Obsidian vault

_Indexer · MCP server · Obsidian plugin_

AILSS connects LLMs to your Obsidian vault (your “second brain”):

- Index your notes into a local SQLite DB (text chunks + embeddings + structured metadata).
- Expose “memory retrieval” tools via an MCP server (for Codex CLI or other MCP clients).
- Optionally surface the same retrieval experience inside Obsidian via a desktop plugin.

The Obsidian vault itself usually lives outside this repo. This repo is the code + docs workspace.

## How it works

1. **Indexer** scans Markdown notes, chunks them, generates embeddings via OpenAI, and writes a local DB at `<vault>/.ailss/index.sqlite`.
2. **MCP server** reads the DB and exposes retrieval tools (semantic search + metadata/typed-link queries).
3. **Obsidian plugin** provides a UI surface and can spawn/manage the local processes on desktop.

Safety model:

- The MCP server is read-only by default; anything that writes notes must be explicitly gated.
- The DB uses SQLite WAL mode, so even “read” processes need write access to the DB directory for `*-wal`/`*-shm` sidecar files.

## Documentation

Start here:

- [docs/README.md](docs/README.md)
- [docs/00-context.md](docs/00-context.md) → [docs/03-plan.md](docs/03-plan.md)
- [docs/ops/local-dev.md](docs/ops/local-dev.md) (runbook)
- [docs/ops/codex-cli.md](docs/ops/codex-cli.md) (Codex CLI sandbox + MCP)

## Repo structure

This repo is a pnpm workspace monorepo under `packages/`:

- `packages/core/`: parsing/chunking + schema + DB queries + env loading
- `packages/indexer/`: indexing CLI (embeddings + DB writes)
- `packages/mcp/`: MCP server (DB-backed read tools)
- `packages/obsidian-plugin/`: Obsidian desktop plugin (UI + process management)

## Quickstart (desktop-first)

### 1) Configure env

Create `.env` at the repo root (see `.env.example`) and set:

- `OPENAI_API_KEY`
- `AILSS_VAULT_PATH` (absolute path to the vault root)
- `OPENAI_EMBEDDING_MODEL` (optional; default `text-embedding-3-large`)

### 2) Install / build

```bash
CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile
pnpm build
```

### 3) Index the vault

```bash
pnpm -C packages/indexer start
```

Common options:

- Use a specific embedding model: `pnpm -C packages/indexer start -- --model text-embedding-3-small`
- Reset/recreate the DB (recommended when switching models): `pnpm -C packages/indexer start -- --reset-db`
- Index only some files: `pnpm -C packages/indexer start -- --paths "notes/a.md" "notes/b.md"`

### 4) Run the MCP server (STDIO)

```bash
pnpm -C packages/mcp start
```

Implemented tools include:

- `semantic_search`
- `activate_context` (seed + typed-link neighborhood expansion)
- `get_note`, `get_note_meta`
- `search_notes`, `find_notes_by_typed_link`

## Embedding model switches (important)

The index DB records the embedding model/dimension and refuses to start if they don’t match the current config.

When switching `OPENAI_EMBEDDING_MODEL`:

- Reset the DB and reindex (`--reset-db`), or
- Use a separate DB file via `--db` to keep multiple indexes side-by-side.

## Codex CLI sandbox note

If you run the MCP server from Codex CLI with `sandbox_mode = "workspace-write"`, you must allow writes to the vault DB directory (`<vault>/.ailss/`) so SQLite can create WAL sidecar files. See [docs/ops/codex-cli.md](./docs/ops/codex-cli.md).

## Obsidian plugin (ailss-obsidian)

The plugin lives in `packages/obsidian-plugin/` and is desktop-only.

- Build: `pnpm -C packages/obsidian-plugin build`
- Install: copy to `<Vault>/.obsidian/plugins/ailss-obsidian/` or symlink for development
- Settings: configure the MCP and indexer commands/args (use an absolute `node` path if Obsidian can’t find it)
