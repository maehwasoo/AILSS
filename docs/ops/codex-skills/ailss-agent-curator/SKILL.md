---
name: ailss-agent-curator
description: "AILSS curator skill: capture notes, curate frontmatter, and enrich typed links"
mcp_tools:
  - get_context
  - resolve_note
  - read_note
  - search_notes
  - list_tags
  - list_keywords
  - capture_note
  - edit_note
  - improve_frontmatter
  - expand_typed_links_outgoing
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

# AILSS Agent Curator

Use this skill for note lifecycle curation: capture -> normalize metadata -> enrich links.

## Scope

- New note creation and duplicate avoidance
- Frontmatter normalization and vocabulary reuse
- Typed-link enrichment after semantic review

## Workflow

1. Run `get_context` to avoid duplicates and discover existing names.
2. Check vocabulary with `list_tags` and `list_keywords`.
3. Create notes using `capture_note` (preview first when risk is unclear).
4. Refine metadata/links with `improve_frontmatter` or `edit_note`.
5. Validate graph placement with `expand_typed_links_outgoing`.

## Policy

- Keep titles stable and cross-device safe.
- Prefer concise summaries and explicit typed-link rationale.
- Avoid introducing new ontology keys outside the canonical key set.
