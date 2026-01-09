---
name: ailss-prometheus-agent
description: Retrieval-first AILSS vault workflow for Codex CLI (uses MCP read tools first; gated writes)
mcp_tools:
  # Always available (read tools)
  - get_context
  - get_typed_links
  - read_note
  - get_vault_tree
  - frontmatter_validate
  - find_broken_links
  - suggest_typed_links
  - sequentialthinking_hydrate
  # Only when write tools are enabled (AILSS_ENABLE_WRITE_TOOLS=1)
  - sequentialthinking
  - capture_note
  - edit_note
  - improve_frontmatter
  - relocate_note
---

# Prometheus Agent (AILSS Codex skill)

Use this skill when you want to work “retrieval-first” against an AILSS Obsidian vault.

## Core workflow

1. Start with `get_context` for the user’s query (avoid guessing and avoid duplicates).
2. Use `get_typed_links` to navigate the semantic graph from a specific note (DB-backed).
3. Use `read_note` to confirm exact wording and frontmatter before making claims.

## Tool availability (important)

- Read tools are always registered.
- Write tools are **not** registered by default. They require `AILSS_ENABLE_WRITE_TOOLS=1`.
- If a write tool is missing, do not “simulate” a write. Ask the user to enable write tools or proceed read-only.

## Safe writes (when enabled)

- Prefer `apply=false` first (dry-run), then confirm with the user, then `apply=true`.
- For edits, use `expected_sha256` to avoid overwriting concurrent changes.
- Keep identity fields safe: do not override `id`/`created` unless the user explicitly requests it.

## Preflight

If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.
