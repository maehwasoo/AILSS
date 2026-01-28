# AILSS

**Actionable Integrated Linked Semantic System**.

AILSS helps you structure knowledge in Obsidian and work efficiently with AI.
Your Obsidian vault is the single source of truth.

AILSS connects AI tooling to an Obsidian vault by building a local index database and exposing retrieval tools over MCP.

## Quickstart

1. Build and install the Obsidian plugin from `packages/obsidian-plugin/`.
2. In Obsidian plugin settings, set your `OPENAI_API_KEY` and run **AILSS: Reindex vault**.
3. Enable the “MCP service (Codex, localhost)” setting and copy the token.

### Codex CLI

4. Add this to `~/.codex/config.toml` (replace `<token>`):

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

### Claude Code

4. Add the MCP server in Claude Code:

```json
{
  "mcpServers": {
    "ailss": {
      "type": "http",
      "url": "http://127.0.0.1:31415/mcp",
      "headers": {
        "Authorization": "Bearer ${AILSS_MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

Set `AILSS_MCP_BEARER_TOKEN` to the token from step 3.

## Prompts and Codex skill

- Vault prompt: use **Prompt installer (vault root)** to write `AGENTS.md` at your vault root.
- Codex skill: use **Copy Prometheus Agent skill (Codex)** and install `~/.codex/skills/ailss-prometheus-agent/SKILL.md`.

## How it works

AILSS writes a local index DB at `<vault>/.ailss/index.sqlite` and serves retrieval over an MCP endpoint hosted by the Obsidian plugin.
This setup lets Codex connect over HTTP without needing direct vault filesystem permissions.

## Vault model

AILSS treats your vault as a knowledge graph:

- YAML frontmatter: structured note metadata
- Typed links: semantic relations (graph edges)
- Body wikilinks: navigation (non-semantic by default)

Full rules: `docs/standards/vault/README.md`.

## MCP tools

Full reference: `docs/01-overview.md` and `docs/reference/mcp-tools.md`.

- Read tools: `get_context`, `get_typed_links`, `resolve_note`, `read_note`, `search_notes`, `list_tags`, `list_keywords`, `find_broken_links`, `frontmatter_validate`, `suggest_typed_links`, `find_typed_link_backrefs`
- Write tools (gated): `capture_note`, `edit_note`, `improve_frontmatter`, `relocate_note`  
  Requires `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`.

## Docs

- `docs/README.md`: documentation index
- `docs/01-overview.md`: architecture + MCP tool surface
- `docs/ops/codex-cli.md`: Codex CLI setup
- `docs/ops/local-dev.md`: local development
- `docs/standards/vault/README.md`: vault model and rules
