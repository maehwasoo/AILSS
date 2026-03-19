# AILSS

**Actionable Integrated Linked Semantic System**.

AILSS is a local-first knowledge backend for Obsidian with a Python-owned local runtime.
Your Obsidian vault remains the single source of truth.

Today, AILSS ships the Obsidian plugin as the local UX shell and `apps/api` as the
Python-owned service/runtime layer for indexing, MCP, retrieval, agent orchestration,
evaluation, and lightweight observability.

## What AILSS Solves

AILSS is not an agent-owned memory layer.
Instead, it keeps context in your vault: notes you can read, edit, and maintain.
AI tools consult that context through explicit, auditable retrieval over MCP.
By default, tools are read-only; any writes are gated and require an explicit apply.

For this phase, the product boundary stays local-first and single-user. Remote hosting,
multi-tenant SaaS concerns, and heavy cloud-first infrastructure are intentionally out of
scope.

## Runtime Direction

- Obsidian plugin: local UX shell and launcher
- Python service app (`apps/api`): indexer CLI, localhost MCP HTTP service, and FastAPI
  backend
- Remaining TypeScript package (`packages/core`): schema/reference utilities only, not a
  shipped runtime service
- Safety rule: explicit write gating stays preserved across the Python MCP surface

Architecture and API contract: `docs/architecture/python-first-local-agent-backend.md`.
Removal completion and compatibility record:
`docs/architecture/legacy-node-typescript-runtime-removal.md`.

## Architecture

Python runtime (current baseline):

### Package structure (monorepo)

```mermaid
flowchart LR
  core["@ailss/core"]
  api["apps/api<br/>(ailss-api / ailss-indexer / ailss-mcp-http)"]
  plugin["obsidian-plugin"]

  api -.->|keeps schema/tools aligned with| core
  plugin -.->|spawns| api
```

### Runtime flow

```mermaid
flowchart LR
  vault["Obsidian vault<br/>(Markdown notes)"]
  db["Local index DB<br/><vault>/.ailss/index.sqlite"]

  indexer["Python indexer<br/>(ailss-indexer)"]
  mcpServer["Python MCP service<br/>(ailss-mcp-http)"]
  pythonApi["Python backend<br/>(ailss-api)"]
  clients["AI clients<br/>(Codex CLI, Claude Code, future UI flows)"]
  obsidian["Obsidian plugin"]

  vault -->|read| indexer -->|write| db
  db -->|query| mcpServer -->|MCP: HTTP| clients
  db -->|query| pythonApi
  vault -->|read previews| pythonApi

  obsidian -.->|triggers| indexer
  obsidian -.->|hosts| mcpServer
  obsidian -.->|starts + monitors| pythonApi
  obsidian -.->|retrieve/agent/eval commands| pythonApi
  clients -.->|write tools: gated, explicit apply| mcpServer
```

### Code structure

```mermaid
flowchart TB
  subgraph core["@ailss/core"]
    core_vault["src/vault/*<br/>(frontmatter + typed links)"]
    core_db["src/db/*<br/>(SQLite schema + queries)"]
    core_indexing["src/indexing/*<br/>(chunking helpers)"]
  end

  subgraph api["apps/api"]
    api_cli["src/ailss_api/cli.py<br/>(ailss-api)"]
    api_indexer["src/ailss_api/indexer_cli.py<br/>(ailss-indexer)"]
    api_mcp["src/ailss_api/mcp_cli.py<br/>(ailss-mcp-http)"]
    api_main["src/ailss_api/main.py<br/>(FastAPI routes)"]
    api_mcp_runtime["src/ailss_api/mcp_runtime.py<br/>(MCP tool implementations)"]
    api_agent["src/ailss_api/agent.py<br/>(LangGraph workflow)"]
    api_retrieval["src/ailss_api/retrieval_*<br/>(semantic + lexical retrieval)"]
    api_eval["src/ailss_api/evals.py<br/>(eval artifacts)"]
  end

  subgraph plugin["obsidian-plugin"]
    plugin_main["src/main.ts<br/>(Obsidian entry)"]
    plugin_mcp["src/mcp/*<br/>(MCP service wrapper)"]
    plugin_python["src/pythonApi/*<br/>(Python backend wrapper)"]
    plugin_indexer["src/indexer/*<br/>(indexer runner)"]
    plugin_ui["src/ui/*<br/>(Obsidian UI)"]
  end
```

## Quickstart

1. Download `ailss-<ver>.zip` from GitHub Releases.
2. Extract it into `<Vault>/.obsidian/plugins/ailss-obsidian/`.
3. Install bundled Python service dependencies once:

```bash
uv sync --directory "<Vault>/.obsidian/plugins/ailss-obsidian/ailss-service/apps/api" --locked
```

4. Install Python 3.12+ and `uv` on the machine running Obsidian.
5. In Obsidian plugin settings, set your `OPENAI_API_KEY` and run **AILSS: Reindex vault**.
6. The plugin starts the Python backend and localhost MCP service by default. Copy the MCP
   token from settings if you want Codex/Claude Code access.

### Codex CLI

7. Add this to `~/.codex/config.toml` (replace `<token>`):

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

### Claude Code

7. Add the MCP server in Claude Code:

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

Set `AILSS_MCP_BEARER_TOKEN` to the token from step 7.

### Obsidian Python backend commands

After enabling the local Python backend, the plugin exposes these commands:

- `AILSS: Check Python backend health`
- `AILSS: Retrieve with Python backend`
- `AILSS: Ask Python backend agent`
- `AILSS: Run Python backend eval`

The current agent path is a grounded local baseline: semantic retrieval + LangGraph
workflow + deterministic answer synthesis with inspectable citations.

## How it works

AILSS writes a local index DB at `<vault>/.ailss/index.sqlite`, serves MCP over the
Obsidian-managed Python localhost service, and starts a local Python backend for retrieval,
agent execution, evaluation, and run artifacts.

This setup lets Codex connect over HTTP without needing direct vault filesystem permissions.

### Vault model

AILSS treats your vault as a knowledge graph:

- YAML frontmatter: structured note metadata.
  - Required keys: `id` (`YYYYMMDDHHmmss`, derived from `created`), `created`, `title`, `summary`, `aliases`, `entity`, `layer`, `tags`, `keywords`, `status`, `updated`, `source`.
- Typed links: frontmatter keys of wikilinks for semantic relations (graph edges).
  - Common keys: `instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `cites`, `authored_by`, `same_as`, `supersedes`.

Full rules: `docs/standards/vault/README.md`.

## MCP tools

Full reference: `docs/01-overview.md` and `docs/reference/mcp-tools.md`.

- Read tools: `get_context`, `expand_typed_links_outgoing`, `resolve_note`, `find_typed_links_incoming`, `list_typed_link_rels`, `read_note`, `get_vault_tree`, `frontmatter_validate`, `find_broken_links`, `search_notes`, `list_tags`, `list_keywords`, `get_tool_failure_report`
- Write tools (gated): `capture_note`, `canonicalize_typed_links`, `edit_note`, `improve_frontmatter`, `relocate_note`  
  Requires `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`.

## Docs

- `docs/README.md`: documentation index
- `docs/01-overview.md`: architecture + MCP tool surface
- `docs/architecture/python-first-local-agent-backend.md`: Python-owned service boundaries and API contract
- `docs/architecture/python-mcp-parity.md`: Python MCP tool surface and parity verification record
- `docs/architecture/legacy-node-typescript-runtime-removal.md`: removal completion record for the retired Node runtime path
- `docs/ops/codex-cli.md`: Codex CLI setup
- `docs/ops/local-dev.md`: local development
- `docs/standards/vault/README.md`: vault model and rules
- `docs/reference/mcp-tools.md`: MCP tools reference

## Prompts and Skill

- Vault prompt: use **Prompt installer (vault root)** to write `AGENTS.md` at your vault root.
- Agent Skill: use **Copy Prometheus Agent Skill** and install it in your terminal AI client’s skill directory (for example, Codex CLI uses `~/.codex/skills/ailss-prometheus-agent/SKILL.md`).
