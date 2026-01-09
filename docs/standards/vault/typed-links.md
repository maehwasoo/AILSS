# Typed links

## Typed link rules

- Record semantic relations only as typed links in YAML frontmatter.
- Record them only in the forward direction. Incoming/back-references are derived by queries/graphs.
- In the note body, use wikilinks freely, but if a relationship is semantic, promote it into frontmatter as a typed link.
- Don’t stop at “what already exists”. After semantic analysis, consider which links _should_ exist and add the missing ones.
- The relationship fields are optional to _fill_ (empty arrays are fine), but if the note implies a relationship, use typed links so the graph is queryable.

### Relation keys (supported)

AILSS indexes and queries typed links by these frontmatter keys:

- Taxonomy (classification): `instance_of`
- Composition (part/whole): `part_of`
- Dependency: `depends_on`, `uses`
- Implementation: `implements`
- Related: `see_also`
- Citation: `cites`
- Authorship / attribution: `authored_by`
- Equivalence / versioning: `same_as`, `supersedes`

If you need a new key, update the rules/ontology first and then use it consistently.

Notes:

- AILSS also extracts **body** `[[wikilinks]]` and stores them as edges with `rel: links_to`.
  - `links_to` is **not** a frontmatter relation key you should write yourself; it is reserved for body-link extraction and navigation/backrefs.

### How AILSS uses typed links (implementation notes)

- Typed links are extracted from frontmatter into a structured edge list (stored as `typed_links` in the index DB).
- The `get_typed_links` tool reads those edges and expands outgoing links into a bounded graph (metadata only).
- Body `[[wikilinks]]` are also extracted and stored as `typed_links` edges with `rel: links_to` for non-semantic navigation and backrefs.
  - Use frontmatter typed links when the relationship is semantic (so queries/graphs can distinguish it from `links_to`).

### Workflow: derive relationships from semantic analysis

1. Identify the target note **S** (identity): confirm `title`, `entity`, `layer`, `summary` first.
2. Collect candidates: extract noun phrases from the body wikilinks, file path, and existing frontmatter.
3. Semantic retrieval: use `get_context` with the following question templates (to gather candidates):
   - “S is a kind of ?” → `instance_of` candidates
   - “S is part of ?” → `part_of` candidates
   - “S depends on ?” → `depends_on` candidates
   - “S uses ?” → `uses` candidates
   - “S implements ?” → `implements` candidates
   - “S cites ?” → `cites` candidates
   - “S is same as ?” (synonyms/duplicates) → `same_as` candidates
   - “S supersedes ?” → `supersedes` candidates
4. Literal verification: use `read_note` to read the actual note text (and confirm you are linking the right target).
5. Normalize: prefer stable titles and keep Korean titles with English parentheses when that is the vault convention (example: `[[클라우드플레어(Cloudflare)]]`).
6. Select and limit: for each category, record only the highest-confidence 1–5 items (avoid over-linking).
7. Order and deduplicate: keep a stable ordering; resolve duplicates via `same_as`.
8. Validate: check for obvious omissions via the coverage checklist below.

### Recommended coverage matrix (by entity)

- Concept (`entity: concept`)
  - Required: `instance_of: ['[[concept]]']`
  - Recommended: `see_also`, `cites`
- Document (`entity: document`)
  - Required: `part_of`
  - Recommended: `cites`, and optionally `same_as` (duplicates), `supersedes` (newer replacement)
- Project (`entity: project`, strategic)
  - Required: `part_of` (program/area), `depends_on` (core platform/tools)
  - Recommended: `implements` (standards/architectures), `uses`
- Procedure (`entity: procedure`, operational)
  - Required: `implements` (pipeline/policy), `uses` (tools)
  - Recommended: `cites` (reference docs)
- Software / tool (`entity: software` or `entity: tool`)
  - Recommended: `part_of` (ecosystem/hub), `depends_on` (runtime/framework), `see_also`
- Dataset (`entity: dataset`)
  - Recommended: `part_of` (domain), `depends_on` (schema/source), `cites` (origin)

The matrix is a baseline. If more links are justified, add them, but stay within the supported key set.

### Coverage checklist

- Classification recorded? → `instance_of`
- Parent/hub recorded? → `part_of`
- External dependencies recorded? → `depends_on`
- Directly used tools/services recorded? → `uses`
- Specs/standards implemented recorded? → `implements`
- Sources recorded? → `cites` (and/or `source` in frontmatter schema for non-note sources)
- Equivalence/replacement recorded? → `same_as`, `supersedes`
- Authorship recorded when applicable? → `authored_by`

### Writing rules

- Store values as arrays (empty arrays are fine).
- Wikilink forms are all acceptable: `[[Title]]`, `[[Folder/Note]]`, `[[Folder/Note|Title]]` (and anchors like `[[Note#Heading]]`).
- Prefer `[[path|title]]` when you want stable storage but title-only display.
- Tools may emit JSON-style inline arrays (for example `[]` and `["inbox"]`); multi-line YAML arrays are also accepted.
- Use only the keys defined in this doc (or the canonical list in code). Do not invent new relationship keys ad hoc.

### Example frontmatter snippet

```yaml
instance_of:
  - "[[guide]]"
part_of:
  - "[[WorldAce]]"
depends_on:
  - "[[Vite]]"
  - "[[클라우드플레어(Cloudflare)]]"
uses:
  - "[[Obsidian]]"
implements:
  - "[[CI 파이프라인(CI Pipeline)]]"
cites:
  - "[[문헌 제목(Reference Title)]]"
same_as: []
supersedes: []
authored_by: []
```
