---
name: ailss-agent-ontology
description: "AILSS ontology skill: typed-link relation selection, directionality, and governance"
mcp_tools:
  - get_context
  - resolve_note
  - read_note
  - expand_typed_links_outgoing
  - find_typed_links_incoming
  - frontmatter_validate
  - improve_frontmatter
  - edit_note
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

# AILSS Agent Ontology

Use this skill when the primary task is deciding or validating typed-link relations.

## Scope

- Relation-key choice (`instance_of`, `part_of`, `depends_on`, ...)
- Directionality (forward-only typed links)
- Coverage checks and ontology governance

## Workflow

1. Pull candidates with `get_context`.
2. Verify exact source/target wording via `resolve_note` + `read_note`.
3. Inspect graph context with `expand_typed_links_outgoing` and optional incoming checks.
4. Update frontmatter with `improve_frontmatter` or `edit_note`.
5. Re-run `frontmatter_validate` when broad updates were applied.

## Canonical docs

- Index: `docs/standards/vault/typed-links.md`
- Relation catalog: `docs/standards/vault/typed-links-relation-catalog.md`
- Decision tree: `docs/standards/vault/typed-links-decision-tree.md`
- Governance: `docs/standards/vault/typed-links-governance.md`
