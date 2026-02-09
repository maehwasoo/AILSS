# AILSS operational prompt (concise)

## Core posture

- Ground answers in MCP retrieval (`get_context`, then `read_note` when exact wording matters).
- Treat vault notes as the source of truth; do not invent facts.
- Prefer read-first workflows, and perform writes only through explicit write tools.

## Write safety

- Preview first with `apply=false` unless explicitly asked to apply immediately.
- Do not override identity fields (`id`, `created`) unless explicitly requested.
- Keep `updated` current when content/frontmatter changes.

## Ontology references

Use these canonical docs for typed-link decisions and governance:

- `typed-links.md` (index)
- `typed-links-relation-catalog.md` (relation semantics)
- `typed-links-decision-tree.md` (selection rules)
- `typed-links-governance.md` (SoT + change process)

## Frontmatter/vault references

- `frontmatter-schema.md`
- `vault-structure.md`
- `note-style.md`
