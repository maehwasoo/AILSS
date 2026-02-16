---
name: ailss-prometheus-agent
description: "Compatibility shim for one release cycle: forwards to ailss-agent"
mcp_tools:
  # Always available (read tools)
  - get_context
  - expand_typed_links_outgoing
  - resolve_note
  - read_note
  - get_vault_tree
  - frontmatter_validate
  - find_broken_links
  - find_typed_links_incoming
  - search_notes
  - list_tags
  - list_keywords
  - list_typed_link_rels
  - get_tool_failure_report
  # Only when write tools are enabled (AILSS_ENABLE_WRITE_TOOLS=1)
  - capture_note
  - canonicalize_typed_links
  - edit_note
  - improve_frontmatter
  - relocate_note
typed_link_keys:
  - instance_of
  - part_of
  - depends_on
  - uses
  - implements
  - cites
  - summarizes
  - derived_from
  - explains
  - supports
  - contradicts
  - verifies
  - blocks
  - mitigates
  - measures
  - produces
  - authored_by
  - owned_by
  - supersedes
  - same_as
---

# Compatibility shim: ailss-prometheus-agent

This legacy skill name is kept for one release cycle.

- Canonical replacement: `ailss-agent`
- New modular companions:
  - `ailss-agent-ontology`
  - `ailss-agent-curator`
  - `ailss-agent-maintenance`

Use this shim when existing local Codex setups still reference `ailss-prometheus-agent`.

## Core workflow

1. Start with `get_context` for the user query.
2. Resolve exact note targets via `resolve_note` + `read_note` before making claims.
3. Use `search_notes` for metadata filtering and `expand_typed_links_outgoing` for graph navigation.
4. Keep semantic relations in YAML frontmatter typed links (not ad-hoc body link sections).
5. Use write tools only when they are enabled, and prefer `apply=false` preview first.

## Typed-link ontology

- Canonical relation key order (for tooling/tests): `instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `cites`, `summarizes`, `derived_from`, `explains`, `supports`, `contradicts`, `verifies`, `blocks`, `mitigates`, `measures`, `produces`, `authored_by`, `owned_by`, `supersedes`, `same_as`
- Ontology references:
  - `docs/standards/vault/typed-links.md`
  - `docs/standards/vault/typed-links-relation-catalog.md`
  - `docs/standards/vault/typed-links-decision-tree.md`
  - `docs/standards/vault/typed-links-governance.md`

## Write safety

- Do not override identity fields (`id`, `created`) unless explicitly requested.
- Use `expected_sha256` for note edits to avoid clobbering concurrent changes.
- Confirm reindex summaries after write-tool execution.
