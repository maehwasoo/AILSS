# Typed links

## Typed link rules

- Record semantic relations only as typed links in YAML frontmatter.
- Record them only in the forward direction. Incoming/back-references are derived by queries/graphs.
- Avoid adding new body wikilinks as part of the standard workflow; record semantic relations as typed links in YAML frontmatter.
- Don’t stop at “what already exists”. After semantic analysis, consider which links _should_ exist and add the missing ones.
- The relationship fields are optional to _fill_, but omit the key when you have no values (do not keep empty arrays). If the note implies a relationship, use typed links so the graph is queryable.
- Keep `cites` strict: use it only when this note cites another note as a source. Do not use `cites` as a generic “related” edge.

### Relation keys (supported)

AILSS indexes and queries typed links by these frontmatter keys:

- Taxonomy (classification): `instance_of`
- Composition (part/whole): `part_of`
- Dependency: `depends_on`, `uses`
- Implementation: `implements`
- Citation (strict): `cites`
- Content transformation: `summarizes`, `derived_from`
- Explanation/evidence: `explains`, `supports`, `contradicts`, `verifies`
- Risk/control/measurement: `blocks`, `mitigates`, `measures`
- Process output: `produces`
- Responsibility: `authored_by`, `owned_by`
- Equivalence / versioning: `supersedes`, `same_as`

Canonical relation key order (for tooling/tests): `instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `cites`, `summarizes`, `derived_from`, `explains`, `supports`, `contradicts`, `verifies`, `blocks`, `mitigates`, `measures`, `produces`, `authored_by`, `owned_by`, `supersedes`, `same_as`

Semantics notes:

- `derived_from` includes extraction/refactoring and translation/paraphrase. Do not add a separate `translates` key.
- `measures` links to the observed target note (what is measured), not to a numeric value itself.
- `produces` links a process/procedure/pipeline note to output artifact/data/release notes.
- `owned_by` is current operational ownership and is distinct from `authored_by` (content author/attribution).

If you need a new key, update the rules/ontology first and then use it consistently.

Implementation sources of truth (when adding/changing relation keys):

- Code: `packages/core/src/vault/typedLinkOntology.ts` (`AILSS_TYPED_LINK_ONTOLOGY` → derived `AILSS_TYPED_LINK_KEYS`) is the canonical list of frontmatter keys that AILSS recognizes as typed links.
  - Only keys in this list are extracted from frontmatter and indexed into the `typed_links` table.
- Template: `packages/mcp/src/lib/ailssNoteTemplate.ts` controls which typed-link keys are emitted (and their order) by `capture_note` and `improve_frontmatter`.
- Docs: this file + `./frontmatter-schema.md` define the vault writing rules and supported ontology.

To introduce a new typed-link key, update **all** of the above in the same change set (otherwise the key may exist in notes but won’t be indexed/emitted consistently).

Notes:

- AILSS does not index body wikilinks. Record relationships via YAML frontmatter typed links.

### How AILSS uses typed links (implementation notes)

- Typed links are extracted from frontmatter into a structured edge list (stored as `typed_links` in the index DB).
- The `expand_typed_links_outgoing` tool reads those edges and expands outgoing links into a bounded graph (metadata only).

### Workflow: derive relationships from semantic analysis

1. Identify the target note **S** (identity): confirm `title`, `entity`, `layer`, `summary` first.
2. Collect candidates: extract noun phrases from the body text, file path, and existing frontmatter (then confirm with `get_context` + `read_note`).
3. Semantic retrieval: use `get_context` with the following question templates (to gather candidates):
   - “S is a kind of ?” → `instance_of` candidates
   - “S is part of ?” → `part_of` candidates
   - “S depends on ?” → `depends_on` candidates
   - “S uses ?” → `uses` candidates
   - “S implements ?” → `implements` candidates
   - “S cites ?” → `cites` candidates
   - “S summarizes ?” → `summarizes` candidates
   - “S is derived from ?” → `derived_from` candidates
   - “S explains ?” → `explains` candidates
   - “S supports ?” → `supports` candidates
   - “S contradicts ?” → `contradicts` candidates
   - “S verifies ?” → `verifies` candidates
   - “S blocks ?” → `blocks` candidates
   - “S mitigates ?” → `mitigates` candidates
   - “S measures ?” → `measures` candidates
   - “S produces ?” → `produces` candidates
   - “S is owned by ?” → `owned_by` candidates
   - “S is same as ?” (synonyms/duplicates) → `same_as` candidates
   - “S supersedes ?” → `supersedes` candidates
4. Literal verification: use `read_note` to read the actual note text (and confirm you are linking the right target).
5. Normalize: prefer stable English titles (vault default). Avoid adding translations in parentheses; use frontmatter `aliases` for alternate spellings/translations. Parentheses are OK only for disambiguation (example: Python (programming language)).
6. Select and limit: for each category, record only the highest-confidence 1–5 items (avoid over-linking).
7. Order and deduplicate: keep a stable ordering; resolve duplicates via `same_as`.
8. Validate: check for obvious omissions via the coverage checklist below.

### One-line decision tests

- “This note is a summary of X” → `summarizes: [[X]]`
- “This note was produced by transforming X (including translation/paraphrase)” → `derived_from: [[X]]`
- “This note helps you understand X” → `explains: [[X]]`
- “This note is evidence for X” → `supports: [[X]]`
- “This note disagrees with X” → `contradicts: [[X]]`
- “This note tested or validated X” → `verifies: [[X]]`
- “This note cannot proceed until X is resolved” → `blocks: [[X]]`
- “This note reduces risk/impact for X” → `mitigates: [[X]]`
- “This note records metrics/observations for X” → `measures: [[X]]`
- “This process/procedure note outputs X” → `produces: [[X]]`
- “This note’s operational owner is X (team/person)” → `owned_by: [[X]]`

### Recommended coverage matrix (by entity)

- Concept (`entity: concept`)
  - Required: `instance_of` (concept wikilink; see example snippet below)
  - Recommended: `cites`
- Document (`entity: document`)
  - Required: `part_of`
  - Recommended: `cites`, and optionally `supersedes` (newer replacement), `same_as` (duplicates)
- Project (`entity: project`, strategic)
  - Required: `part_of` (program/area), `depends_on` (core platform/tools)
  - Recommended: `implements` (standards/architectures), `uses`, `owned_by`
- Procedure (`entity: procedure`, operational)
  - Required: `implements` (pipeline/policy), `uses` (tools)
  - Recommended: `cites` (reference docs), `produces`
- Software / tool (`entity: software` or `entity: tool`)
  - Recommended: `part_of` (ecosystem/hub), `depends_on` (runtime/framework)
- Dataset (`entity: dataset`)
  - Recommended: `part_of` (domain), `depends_on` (schema/source), `cites` (origin)

The matrix is a baseline. If more links are justified, add them, but stay within the supported key set.

### Coverage checklist

- Classification recorded? → `instance_of`
- Parent/hub recorded? → `part_of`
- External dependencies recorded? → `depends_on`
- Directly used tools/services recorded? → `uses`
- Specs/standards implemented recorded? → `implements`
- Sources recorded? → `cites` (strict citation, and/or `source` in frontmatter schema for non-note sources)
- Summary relationship recorded when applicable? → `summarizes`
- Transform/paraphrase relationship recorded when applicable? → `derived_from`
- Explanation relationship recorded when applicable? → `explains`
- Supporting evidence relationship recorded when applicable? → `supports`
- Contradiction relationship recorded when applicable? → `contradicts`
- Verification relationship recorded when applicable? → `verifies`
- Blocking relationship recorded when applicable? → `blocks`
- Mitigation relationship recorded when applicable? → `mitigates`
- Measurement relationship recorded when applicable? → `measures`
- Output relationship recorded when applicable? → `produces`
- Equivalence/replacement recorded? → `supersedes`, `same_as`
- Authorship recorded when applicable? → `authored_by`
- Operational ownership recorded when applicable? → `owned_by`

### Writing rules

- Store values as arrays, and omit the key when you have no values (do not keep empty arrays).
- Wikilink forms are all acceptable (title, folder path, display text, and anchors); see examples below.
- Prefer path + display text when you want stable storage but title-only display.
- Tools may emit JSON-style inline arrays (for example `[]` and `["inbox"]`); multi-line YAML arrays are also accepted.
- Use only the keys defined in this doc (or the canonical list in code). Do not invent new relationship keys ad hoc.

```md
[[Title]]
[[Folder/Note]]
[[Folder/Note|Title]]
[[Note#Heading]]
```

### Example frontmatter snippet

```yaml
instance_of:
  - "[[guide]]"
part_of:
  - "[[WorldAce]]"
depends_on:
  - "[[Vite]]"
  - "[[Cloudflare]]"
uses:
  - "[[Obsidian]]"
implements:
  - "[[CI Pipeline]]"
cites:
  - "[[Reference Title]]"
summarizes:
  - "[[Source Summary Target]]"
derived_from:
  - "[[Original Source]]"
explains:
  - "[[Concept Target]]"
supports:
  - "[[Claim Target]]"
contradicts:
  - "[[Conflicting Claim]]"
verifies:
  - "[[Experiment Target]]"
blocks:
  - "[[Blocked Task]]"
mitigates:
  - "[[Risk Note]]"
measures:
  - "[[Service Reliability]]"
produces:
  - "[[Daily Metrics Report]]"
owned_by:
  - "[[SRE Team]]"
```
