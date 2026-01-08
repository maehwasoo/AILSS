# AILSS

**AILSS** = **Actionable Integrated Linked Semantic System**

- Structure knowledge + memory, and work efficiently with AI.
- Your Obsidian **vault is the SSOT** (Single Source of Truth) and the root of decisions.

AILSS connects LLM tooling to an Obsidian vault by building a local index DB and exposing retrieval + (optional) write tools over **MCP** (Model Context Protocol).

## Architecture (high level)

- **Vault (SSOT)**: your `.md` notes
- **Indexer**: chunks notes, generates embeddings, writes `<vault>/.ailss/index.sqlite`
- **MCP service (localhost)**: Obsidian-hosted, token-protected, multi-session MCP over HTTP (`/mcp`)
- **Codex CLI (or any MCP client)**: connects via URL + token; does not need vault filesystem permissions when using the plugin-hosted HTTP service

## Setup (Codex CLI + Obsidian plugin)

1. Install/build the Obsidian plugin from `packages/obsidian-plugin/` (desktop-first).
2. In Obsidian plugin settings:
   - Set your `OPENAI_API_KEY` (used for embeddings + semantic search queries)
   - (Optional) set embedding model (default: `text-embedding-3-large`)
   - Run/trigger indexing (command: **AILSS: Reindex vault**)
   - Enable **MCP service (Codex, localhost)** and copy the config block
3. Paste into `~/.codex/config.toml`:

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

## MCP tools

Read tools (current):

- `get_context`
- `get_typed_links`
- `read_note`
- `get_vault_tree`
- `frontmatter_validate`

Write tools (gated; require `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`):

- `capture_note` (creates a new inbox note with full frontmatter)
- `edit_note` (line-based patch ops; supports dry-run)
- `relocate_note` (move/rename a note; supports dry-run)

## Notes / safety

- Local-only: the MCP service binds to `127.0.0.1` and requires a token.
- Write tools are gated (plugin toggle) and must be explicitly applied.
- Embeddings use the OpenAI API and can incur costs on large vaults.

## Docs

Start here:

- `docs/README.md` (documentation index)
- `docs/00-context.md` → `docs/01-overview.md` → `docs/02-significance.md` → `docs/03-plan.md`
- `docs/ops/codex-cli.md` (Codex CLI + MCP config + troubleshooting)
- `docs/ops/local-dev.md` (local dev runbook)
- `docs/ops/agents-snippet.md` (AGENTS.md prompt snippet for using AILSS MCP tools)
