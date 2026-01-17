# AILSS

AILSS (**Actionable Integrated Linked Semantic System**) connects AI tooling to an Obsidian vault by building a local index database and exposing retrieval tools over MCP (Model Context Protocol).

- Single source of truth: your vault
- Retrieval-first workflow (DB-backed reads)
- Writes are gated (`apply=true`) and auditable

## Quickstart (Codex CLI + Obsidian)

1. Build and install the Obsidian plugin (`packages/obsidian-plugin/`).
2. In plugin settings, set `OPENAI_API_KEY`, then run **AILSS: Reindex vault**.
3. Enable “MCP service (Codex, localhost)” and copy the Codex config block.
4. Paste it into `~/.codex/config.toml` and replace `<token>` with the value shown by the plugin.

```toml
[mcp_servers.ailss]
url = "http://127.0.0.1:31415/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

## Docs

- Start here: `docs/README.md`
- Recommended reading order: `docs/00-context.md` → `docs/01-overview.md` → `docs/02-significance.md` → `docs/03-plan.md`
- Common entrypoints: `docs/ops/codex-cli.md`, `docs/ops/local-dev.md`, `docs/standards/vault/README.md`

## Concepts

- AILSS writes an index DB at `<vault>/.ailss/index.sqlite`.
- The Obsidian plugin hosts an MCP endpoint at `http://127.0.0.1:31415/mcp` so Codex can connect over HTTP without vault filesystem permissions.
- Vault model: frontmatter is structured metadata; typed links are semantic relations; body wikilinks are extracted but treated as non-semantic navigation by default.

<details>
<summary><strong>Claude Code setup (MCP)</strong></summary>

You can connect Claude Code to the same Obsidian plugin-hosted MCP service.

1. In the Obsidian plugin settings, enable “MCP service (Codex, localhost)” and generate/copy the bearer token.
2. Add the MCP server (local scope is recommended so you don’t commit secrets):

```bash
claude mcp add --transport http --scope local ailss http://127.0.0.1:31415/mcp \
  --header "Authorization: Bearer <token>"
```

3. Verify it’s configured:

```bash
claude mcp list
```

Optional: if you want a team-shared configuration, Claude Code supports a project-scoped `.mcp.json` in the repo root.
Use environment variable expansion so the token is not committed:

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

</details>

<details>
<summary><strong>Recommended: prompts and Codex skill</strong></summary>

AILSS works best when your assistant is explicitly steered to:

- use MCP tools (retrieval-first, DB-backed reads)
- follow the vault frontmatter + typed-link rules
- keep writes gated (`apply=true`) and auditable
- follow a predictable write workflow (preview with `apply=false`, then apply with `apply=true`)

### Vault prompt file (Obsidian)

In the Obsidian plugin settings, use **Prompt installer (vault root)** to write a prompt file like `AGENTS.md` at the vault root.

Note: prompt contents are bundled at build time; changes require plugin rebuild + reload.

### Codex skill (recommended)

In the Obsidian plugin settings, use **Copy Prometheus Agent skill (Codex)** and install it under your Codex skills folder.

- Recommended path: `~/.codex/skills/ailss-prometheus-agent/SKILL.md`
- Snapshot reference: `docs/ops/codex-skills/prometheus-agent/SKILL.md`

We intentionally avoid per-project/workspace `AGENTS.md` prompts and keep guidance in these two channels only: vault-root prompt + Codex skill.

</details>

<details>
<summary><strong>MCP tools (overview)</strong></summary>

Full reference: `docs/01-overview.md`.

- Read tools (always available): `get_context`, `get_typed_links`, `resolve_note`, `read_note`, `search_notes`, `list_tags`, `list_keywords`, `find_broken_links`, `frontmatter_validate`, `suggest_typed_links`, `find_typed_link_backrefs`
- Write tools (gated): `capture_note`, `edit_note`, `improve_frontmatter`, `relocate_note`  
  Requires `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`.

</details>

<details>
<summary><strong>Safety and costs</strong></summary>

- The MCP service binds to `127.0.0.1` and requires a bearer token.
- Index-time embeddings and `get_context` use the OpenAI embeddings API and can incur costs.
- DB-only tools (`search_notes`, `list_tags`, `list_keywords`, typed-link graph/backrefs) do not call embeddings APIs.

</details>
