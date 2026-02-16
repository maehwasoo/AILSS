# AGENTS.md (docs/standards/vault)

## What this folder is

This folder contains **high-impact canonical rules** for how the AILSS Obsidian vault is modeled and maintained (frontmatter schema + typed links + assistant workflow).

These rules must stay in sync with prompts, validators, and tooling that reads/writes vault notes.

## Canonical reading order

When making schema/ontology decisions, treat these docs as the canonical entrypoints (in this order):

- `README.md`
- `frontmatter-schema.md`
- `typed-links.md`

## Anti-drift constraints (must follow)

- Do not invent new typed-link relation keys in docs or examples.
- Do not rename typed-link keys or change the canonical key order in docs without updating code + tests + templates in the same PR.
- Prefer additive changes. If a breaking change is unavoidable, include a migration plan and update/extend validators accordingly.

## Sync targets (when rules change)

Typed-link ontology (relation keys, semantics, canonical key order):

- `packages/core/src/vault/typedLinkOntology.ts`
- `packages/mcp/src/lib/ailssNoteTemplate.ts`
- `docs/standards/vault/typed-links.md`
- `docs/standards/vault/frontmatter-schema.md`
- `packages/mcp/test/docs.typedLinkOntologyConsistency.test.ts`
- `docs/ops/codex-skills/prometheus-agent/SKILL.md`

Frontmatter required keys / ordering (templates + emitted YAML):

- `packages/mcp/src/lib/ailssNoteTemplate.ts`
- `docs/standards/vault/frontmatter-schema.md`

Prompt installer bundle composition (what gets stitched into installed prompts):

- `packages/obsidian-plugin/src/utils/promptTemplates.ts`
- `docs/standards/vault/README.md`

## Validation (minimum)

- Format: `pnpm format:check`
- If you changed typed-link keys or the canonical key order markers: `pnpm test -- -t "Docs typed-link ontology consistency"`
