---
name: ailss-prometheus-agent
description: "Compatibility shim for one release cycle: forwards to ailss-agent"
mcp_tools:
  # Keep this list aligned with ailss-agent to avoid drift during the shim window.
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
  - capture_note
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

When updating local Codex skills, prefer installing `ailss-agent`.
