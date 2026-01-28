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

## Claude Code (MCP) setup

You can connect Claude Code to the same Obsidian plugin-hosted MCP service.

1. In Obsidian plugin settings, enable “MCP service (Codex, localhost)” and generate/copy the bearer token.
2. Add the MCP server in Claude Code (local scope is recommended so you don’t commit secrets):

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

## Recommended: install guidance (prompts) and Codex skills

AILSS works best when your assistant is explicitly steered to:

- use MCP tools (retrieval-first, DB-backed reads)
- follow the vault frontmatter + typed-link rules
- keep writes gated (`apply=true`) and auditable
- follow a predictable write workflow (preview with `apply=false`, then apply with `apply=true` for common note edits)

### Vault prompt files (Obsidian)

In the Obsidian plugin settings, use **Prompt installer (vault root)** to write a prompt file like `AGENTS.md` at the vault root.

- The prompt is meant to keep assistants aligned with your vault rules (frontmatter schema, typed links, and safe workflows).
- Note: prompt contents are bundled at build time; changes require plugin rebuild + reload.

### Codex skill (recommended)

In the Obsidian plugin settings, use **Copy Prometheus Agent skill (Codex)** and install it under your Codex skills folder:

- Recommended path: `~/.codex/skills/ailss-prometheus-agent/SKILL.md`
- Snapshot reference: `docs/ops/codex-skills/prometheus-agent/SKILL.md`
- Tip: the skill description includes Obsidian/vault/frontmatter keywords to improve implicit skill selection for note-related requests.

We intentionally avoid per-project/workspace `AGENTS.md` prompts and keep guidance in these two channels only: vault-root prompt + Codex skill.

If you skip prompts/skills, assistants are more likely to guess instead of querying MCP tools, and may create notes with incomplete or inconsistent frontmatter/typed links.

## How it works

AILSS writes a local index DB at `<vault>/.ailss/index.sqlite` and serves retrieval over an MCP endpoint hosted by the Obsidian plugin.
This setup lets Codex connect over HTTP without needing direct vault filesystem permissions.

## Vault model

AILSS treats your vault as a **knowledge graph**:

- YAML frontmatter is the structured “note metadata”.
- Frontmatter “typed links” are the structured graph edges (semantic relations).
- Body wikilinks are still useful and are also extracted, but they are treated as **non-semantic navigation** by default.

Example body wikilink:

```md
[[wikilinks]]
```

The indexer normalizes frontmatter and stores it in SQLite (including a `typed_links` table) so tools can build context without guessing.
For the full rules/templates, see `docs/standards/vault/README.md`.

### Required frontmatter fields

All notes should keep these keys (template: `docs/standards/vault/frontmatter-schema.md`):

| field      | type                                                                    | purpose                                                                                 |
| ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `id`       | string (`YYYYMMDDHHmmss`)                                               | stable note identifier; should match the first 14 digits of `created`                   |
| `created`  | string (ISO `YYYY-MM-DDTHH:mm:ss`)                                      | creation time                                                                           |
| `title`    | string                                                                  | canonical title (Obsidian link target)                                                  |
| `summary`  | string \| null                                                          | short human summary (improves retrieval + review)                                       |
| `aliases`  | string[]                                                                | alternate titles (for linking/search)                                                   |
| `entity`   | string \| null                                                          | classification (concept, project, procedure, log, etc.)                                 |
| `layer`    | `strategic` \| `conceptual` \| `logical` \| `physical` \| `operational` | why/what/structure/implementation/operations dimension                                  |
| `tags`     | string[]                                                                | lightweight navigation tags (use sparingly; inbox tag for `100. Inbox/`)                |
| `keywords` | string[]                                                                | controlled vocabulary (reuse existing terms when possible)                              |
| `status`   | `draft` \| `in-review` \| `active` \| `archived`                        | lifecycle state                                                                         |
| `updated`  | string (ISO `YYYY-MM-DDTHH:mm:ss`)                                      | last updated time                                                                       |
| `source`   | string[]                                                                | external sources (URLs/DOIs/tickets/specs); for vault-to-vault citations prefer `cites` |

### Typed links (semantic relations)

Typed links are optional frontmatter keys used to record semantic edges as wikilinks (rules: `docs/standards/vault/typed-links.md`):

- `instance_of`: classification (“is a kind of”)
- `part_of`: composition / parent hub (“is part of”)
- `depends_on`, `uses`: dependencies (“needs/uses”)
- `implements`: implementation of a spec/standard/procedure
- `cites`: citation to other vault notes (use `source` for external sources)
- `authored_by`: authorship / attribution
- `same_as`, `supersedes`: equivalence / replacement

Note: AILSS also extracts body wikilinks (if present) and stores them as `typed_links` edges with `rel: links_to` for non-semantic navigation/backrefs.
This is optional and not part of the recommended authoring workflow.
You should not write `links_to` in frontmatter.

## MCP tools

The list below reflects the current MCP tool surface. For broader architecture details, see `docs/01-overview.md`.

### Read tools (always available)

- `get_context`: semantic retrieval over the index DB with optional vault previews.  
  Required: `query` (string).  
  Options: `top_k` (default 10, 1–50), `max_chars_per_note` (default 800, 200–50,000).
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
  Options: `start_index` (default 0; ≥0), `max_chars` (default 20,000; 200–200,000).  
  Pagination: when `truncated` is true, call again with `start_index = next_start_index`.  
  Note: if the note changes between calls, concatenated chunks may be inconsistent.
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
- `suggest_typed_links`: proposes frontmatter typed-link candidates from already-indexed `links_to` edges (typically derived from body wikilinks, if present) (DB-only).  
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
  Example: `ops: [{ op: "replace_lines", from_line: 15, to_line: 15, text: "hello world" }]`.
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
- `docs/ops/codex-skills/README.md`: Codex skill snapshots (reference)
- `docs/standards/vault/README.md`: vault rules and frontmatter requirements
- `docs/architecture/packages.md`: package structure and dependency direction
- `docs/architecture/data-db.md`: SQLite schema and indexing data model
- `docs/adr/README.md`: architectural decision records (ADRs)
