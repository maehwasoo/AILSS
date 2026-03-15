---
name: ailss-agent
description: "AILSS core skill: retrieval-first MCP workflow, safe writes, and vault-grounded answers"
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
  # Only when write tools are enabled (AILSS_ENABLE_WRITE_TOOLS=1)
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

# AILSS Agent (core)

Use this skill for normal AILSS vault work when you need retrieval-first grounding and safe edits.

## Scope

- Core retrieval workflow
- Frontmatter/typed-link hygiene checks
- Safe write operations (when write tools are enabled)

## Workflow

1. Start with `get_context`.
2. Resolve exact note targets via `resolve_note` + `read_note`.
3. Use `search_notes` for metadata filters and `expand_typed_links_outgoing` / `find_typed_links_incoming` for graph checks.
4. For edits, preview first (`apply=false`) then apply (`apply=true`) when safe.

## Skill composition

Use companion skills when needed:

- `ailss-agent-ontology`: relation-key selection and ontology decision policy
- `ailss-agent-curator`: capture -> curation -> link enrichment workflow
- `ailss-agent-maintenance`: broken-link/reindex/migration maintenance workflow

## Write safety

- Keep `id` / `created` stable unless explicitly requested.
- Update `updated` when content/frontmatter changes.
- Prefer existing `tags` / `keywords` vocabulary before introducing new values.
