# Typed links governance

This document defines how typed-link ontology changes are managed.

## Single source of truth (SoT)

- Code SoT: `packages/core/src/vault/frontmatter.ts` (`AILSS_TYPED_LINK_KEYS`)
- Documentation SoT mirror: `docs/standards/vault/typed-links-relation-catalog.md`
- Skill metadata mirrors: `docs/ops/codex-skills/*/SKILL.md` frontmatter `typed_link_keys`

## Change process

When adding/removing/renaming a typed-link key, update these artifacts in the same change set:

1. `packages/core/src/vault/frontmatter.ts`
2. `packages/mcp/src/lib/ailssNoteTemplate.ts`
3. `docs/standards/vault/typed-links-relation-catalog.md`
4. `docs/standards/vault/frontmatter-schema.md` (if user-facing wording changes)
5. `docs/ops/codex-skills/*/SKILL.md` frontmatter metadata

## CI consistency

CI must fail fast when typed-link keys drift between code/docs/skills.

- Test location: `packages/mcp/test/docs.mcpToolingConsistency.test.ts`
- Validation target: typed-link key parity across code/docs/skills

## Migration policy

- Prefer additive changes with compatibility notes first.
- For destructive ontology changes, provide migration steps and staged rollout.
- Keep compatibility shims for at least one release cycle when renaming externally referenced artifacts.
