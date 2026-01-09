# AILSS

AILSS stands for **Actionable Integrated Linked Semantic System**.

AILSS helps you structure knowledge in Obsidian and work efficiently with AI.
Your Obsidian vault is the single source of truth.

AILSS connects AI tooling to an Obsidian vault by building a local index database and exposing retrieval tools over MCP, the Model Context Protocol.

## Quickstart for Codex CLI and Obsidian

1. Build and install the Obsidian plugin from `packages/obsidian-plugin/`.
2. In Obsidian plugin settings, set your `OPENAI_API_KEY` and run **AILSS: Reindex vault**.
3. Enable the “MCP service (Codex, localhost)” setting and copy the Codex config block.
4. Paste the config into `~/.codex/config.toml` and replace `<token>` with the value shown by the plugin.

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

## How it works

AILSS writes a local index DB at `<vault>/.ailss/index.sqlite` and serves retrieval over an MCP endpoint hosted by the Obsidian plugin.
This setup lets Codex connect over HTTP without needing direct vault filesystem permissions.

## MCP tools

Read tools (current):

- `get_context`
- `get_typed_links`
- `read_note`
- `get_vault_tree`
- `frontmatter_validate`

Write tools (gated; require `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`):

- `capture_note`: new inbox note with full frontmatter
- `edit_note`: line-based patch ops; supports dry-run
- `relocate_note`: move/rename a note; supports dry-run

## Safety and costs

- The MCP service binds to `127.0.0.1` and requires a bearer token.
- Embeddings and query vectors use the OpenAI API and can incur costs on large vaults.
- Write tools are disabled by default and require both `AILSS_ENABLE_WRITE_TOOLS=1` and an explicit request with `apply=true`.

## Docs

- `docs/README.md`: documentation index
- `docs/00-context.md`: current context
- `docs/01-overview.md`: architecture details and the MCP tool surface
- `docs/02-significance.md`: significance and principles
- `docs/03-plan.md`: implementation plan and milestones
- `docs/ops/codex-cli.md`: Codex CLI setup and sandbox troubleshooting
- `docs/ops/local-dev.md`: local development and plugin build instructions
- `docs/ops/testing.md`: testing commands and guidance
- `docs/ops/agents-snippet.md`: AGENTS.md prompt snippet for AILSS MCP usage
- `docs/ops/codex-prompts/README.md`: Codex prompt snippets
- `docs/standards/vault/README.md`: vault rules and frontmatter requirements
- `docs/architecture/packages.md`: package structure and dependency direction
- `docs/architecture/data-db.md`: SQLite schema and indexing data model
- `docs/adr/README.md`: architectural decision records (ADRs)
