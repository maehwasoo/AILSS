# Typed links

This page is the entrypoint for AILSS typed-link ontology.

## Core rules

- Store semantic relations in YAML frontmatter typed-link keys.
- Keep relations directional (outgoing from the current note).
- Omit keys when they have no values (do not keep empty arrays).
- Keep `cites` strict for note-to-note citation.

## Ontology references

- Relation catalog (canonical key semantics): `./typed-links-relation-catalog.md`
- Decision tree (how to choose a relation): `./typed-links-decision-tree.md`
- Governance (SoT + change process): `./typed-links-governance.md`

## Implementation notes

- Canonical key list in code: `packages/core/src/vault/frontmatter.ts` (`AILSS_TYPED_LINK_KEYS`)
- Template emission: `packages/mcp/src/lib/ailssNoteTemplate.ts`
- Skill metadata snapshots: `docs/ops/codex-skills/*/SKILL.md`
