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

## Recommended: install guidance (prompts) and Codex skills

AILSS works best when your assistant is explicitly steered to:

- use MCP tools (retrieval-first, DB-backed reads)
- follow the vault frontmatter + typed-link rules
- keep writes gated (`apply=true`) and auditable

### Vault prompt files (Obsidian)

In the Obsidian plugin settings, use **Prompt installer (vault root)** to write a prompt file like `AGENTS.md` at the vault root.

- The prompt is meant to keep assistants aligned with your vault rules (frontmatter schema, typed links, and safe workflows).
- Note: prompt contents are bundled at build time; changes require plugin rebuild + reload.

### Workspace guidance snippet (optional)

For a ready-to-paste `AGENTS.md` snippet focused on AILSS MCP usage, see `docs/ops/agents-snippet.md`.

### Codex skill (optional, recommended)

In the Obsidian plugin settings, use **Copy Prometheus Agent skill (Codex)** and install it under your Codex skills folder:

- Recommended path: `~/.codex/skills/ailss-prometheus-agent/SKILL.md`
- Snapshot reference: `docs/ops/codex-skills/prometheus-agent/SKILL.md`

If you skip prompts/skills, assistants are more likely to guess instead of querying MCP tools, and may create notes with incomplete or inconsistent frontmatter/typed links.

## How it works

AILSS writes a local index DB at `<vault>/.ailss/index.sqlite` and serves retrieval over an MCP endpoint hosted by the Obsidian plugin.
This setup lets Codex connect over HTTP without needing direct vault filesystem permissions.

## MCP tools

The list below reflects the current MCP tool surface. For broader architecture details, see `docs/01-overview.md`.

### Read tools (always available)

- `get_context`: semantic retrieval over the index DB with optional vault previews.  
  Required: `query` (string).  
  Options: `top_k` (default 10, 1–50), `max_chars_per_note` (default 2000, 200–50,000).
- `get_typed_links`: expands outgoing typed-link graph from a seed note (DB-only; no note body reads).  
  Required: `path`.  
  Options: `max_notes` (default 50, 1–200), `max_edges` (default 2000, 1–10,000), `max_links_per_note` (default 40), `max_resolutions_per_target` (default 5).
- `resolve_note`: resolves an id/title/wikilink target to candidate note paths (DB-only).  
  Required: `query`.  
  Options: `limit` (default 20, 1–200).
- `find_typed_link_backrefs`: finds notes that reference a target via typed links (incoming edges; includes `links_to`).  
  Required: none.  
  Options: `rel`, `to_target`, `limit` (default 100, 1–1000).
- `read_note`: reads a vault Markdown note by path (filesystem).  
  Required: `path`.  
  Options: `max_chars` (default 20,000; 200–200,000).
- `get_vault_tree`: renders a folder tree of vault markdown files.  
  Required: none.  
  Options: `path_prefix`, `include_files` (default false), `max_depth` (default 8, 1–50), `max_nodes` (default 2000, 1–20,000).
- `frontmatter_validate`: scans notes for required YAML frontmatter keys and `id`/`created` consistency.  
  Required: none.  
  Options: `path_prefix`, `max_files` (default 20,000).
- `find_broken_links`: detects unresolved wikilinks/typed links using the index DB.  
  Required: none.  
  Options: `path_prefix`, `rels` (default: `links_to` + typed-link keys), `max_links` (default 20,000), `max_broken` (default 2000), `max_resolutions_per_target` (default 5).
- `search_notes`: searches indexed note metadata (frontmatter-derived fields, tags/keywords/sources) in the local DB (no embeddings).  
  Required: none.  
  Options: `path_prefix`, `title_query`, `note_id`, `entity`, `layer`, `status`, `created_from`, `created_to`, `updated_from`, `updated_to`, `tags_any`, `tags_all`, `keywords_any`, `sources_any`, `order_by`, `order_dir`, `limit`.
- `list_tags`: lists indexed tags with usage counts (helps reuse existing vocabulary).  
  Required: none.  
  Options: `limit` (default 200, 1–5000).
- `list_keywords`: lists indexed keywords with usage counts (helps reuse existing vocabulary).  
  Required: none.  
  Options: `limit` (default 200, 1–5000).
- `suggest_typed_links`: proposes frontmatter typed-link candidates from body wikilinks (DB-only).  
  Required: `path`.  
  Options: `max_links_to_consider` (default 500), `max_suggestions` (default 100), `max_resolutions_per_target` (default 5).

### Write tools (gated)

Write tools are disabled by default and require `AILSS_ENABLE_WRITE_TOOLS=1`. They also require `apply=true` to perform a write.

- `capture_note`: creates a new note with full AILSS frontmatter.  
  Required: `title`.  
  Options: `body` (default ""), `folder` (default `"100. Inbox"`), `frontmatter` (overrides), `apply` (default false), `reindex_after_apply` (default true).
- `edit_note`: applies line-based patch ops to an existing note.  
  Required: `path`, `ops` (insert/delete/replace).  
  Options: `expected_sha256`, `apply` (default false), `reindex_after_apply` (default true).
- `improve_frontmatter`: normalizes/adds required frontmatter keys (and typed-link key normalization).  
  Required: `path`.  
  Options: `expected_sha256`, `apply` (default false), `reindex_after_apply` (default true), `fix_identity` (default false).
- `relocate_note`: moves/renames a note.  
  Required: `from_path`, `to_path`.  
  Options: `apply` (default false), `overwrite` (default false), `reindex_after_apply` (default true).

## Safety and costs

- The MCP service binds to `127.0.0.1` and requires a bearer token.
- Index-time embeddings and query-time vectors (`get_context`) use the OpenAI embeddings API and can incur costs.
- Metadata tools (`search_notes`, `list_tags`, `list_keywords`, typed-link graph/backrefs) are DB-only and do not call embeddings APIs.
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
- `docs/ops/codex-skills/README.md`: Codex skill snapshots (reference)
- `docs/standards/vault/README.md`: vault rules and frontmatter requirements
- `docs/architecture/packages.md`: package structure and dependency direction
- `docs/architecture/data-db.md`: SQLite schema and indexing data model
- `docs/adr/README.md`: architectural decision records (ADRs)
