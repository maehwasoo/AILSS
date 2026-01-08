# AILSS

**AILSS** = **Actionable Integrated Linked Semantic System**

- Structure knowledge + memory, and work efficiently with AI. (지식과 메모리를 구조화하고, AI와 함께 효율적으로 작업)
- Your Obsidian **vault is the SSOT** (Single Source of Truth) and the root of decisions.

AILSS connects LLM tooling to an Obsidian vault by building a local index DB and exposing retrieval + (optional) write tools over **MCP** (Model Context Protocol).

## Architecture (high level)

- **Vault (SSOT)**: your `.md` notes
- **Indexer**: chunks notes, generates embeddings, writes `<vault>/.ailss/index.sqlite`
- **MCP service (localhost)**: Obsidian-hosted, token-protected, multi-session MCP over HTTP (`/mcp`)
- **Codex CLI (or any MCP client)**: connects via URL + token; does not need vault filesystem permissions

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

Read tools:

- `semantic_search`
- `activate_context`
- `get_note`, `get_note_meta`
- `search_notes`, `find_notes_by_typed_link`

Write tools (only when enabled in the plugin; always require `apply=true`):

- `edit_note` (by default reindexes the edited path and returns a reindex summary)
- `reindex_paths`

## Notes / safety

- Local-only: the MCP service binds to `127.0.0.1` and requires a token.
- Write tools are gated (plugin toggle) and must be explicitly applied.
- Embeddings use the OpenAI API and can incur costs on large vaults.

## Docs

- Overview + plan: `docs/README.md`
- Codex integration details: `docs/ops/codex-cli.md`
