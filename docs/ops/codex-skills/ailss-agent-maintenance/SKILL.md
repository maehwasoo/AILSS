---
name: ailss-agent-maintenance
description: "AILSS maintenance skill: broken-link audits, reindex-safe operations, and migrations"
mcp_tools:
  - get_vault_tree
  - frontmatter_validate
  - find_broken_links
  - find_typed_links_incoming
  - search_notes
  - resolve_note
  - read_note
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

# AILSS Agent Maintenance

Use this skill for vault hygiene and migration-safe maintenance work.

## Scope

- Broken-link discovery and remediation
- Frontmatter integrity checks
- Renames/moves with backlink impact awareness

## Workflow

1. Map target areas with `get_vault_tree` and `search_notes`.
2. Audit integrity using `frontmatter_validate` and `find_broken_links`.
3. Check impact/backrefs via `find_typed_links_incoming`.
4. Apply structured fixes with `edit_note` / `improve_frontmatter` / `relocate_note`.
5. Re-audit until no critical link/frontmatter regressions remain.

## Migration posture

- Make small, reversible batches.
- Keep note identity fields stable during path migrations.
- Treat ambiguous target resolution as a review queue, not an auto-fix.
