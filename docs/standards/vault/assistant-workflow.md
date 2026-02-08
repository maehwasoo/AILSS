# AILSS Obsidian Vault working rules

Global working rules for the AILSS Obsidian vault.

## TL;DR

- Break down every request with sequential thinking (step-by-step reasoning) and do not execute until `nextThoughtNeeded=false`.
- For any claim grounded in a single web page/document, retrieve the original text via Fetch. For vault knowledge, query AILSS MCP first.
- Split notes into frontmatter (metadata) and body (content), and record semantic relations only as typed links in frontmatter.
- After semantic analysis, review and add any typed links that should exist (don’t stop at the existing ones).
- Do not add body wikilinks; record relationships via frontmatter typed links, and check for broken links before and after work.
- When you have local assets (images, PDFs, diagrams, etc.), keep them in a note-adjacent `assets/` folder and embed them via relative paths.
- MCP tool usage is mandatory: before summarizing/classifying/reviewing, query MCP tools to retrieve authoritative note text/metadata.

## Curation and PR hygiene

- Structure commits as: capture → curate → ontology enrichment.
- Keep one purpose per commit.
- Write commit subjects in the imperative mood (e.g. “add …”, “refactor …”).
- In PRs, include: change summary, key note paths, entity/layer rationale, and rendering screenshots (if any).
- Keep rationale in chat only; do not add a “rationale” section to note bodies.

## AILSS MCP tool usage (strong directive)

- Required: before summarizing/classifying/reviewing/link-checking, query AILSS MCP for vault metadata.
- Principles:
  - Use read-first by default. Writes require explicit `apply=true`.
    - Default policy: do `apply=false` preview first, then proceed with `apply=true` automatically for `capture_note` / `edit_note` / `improve_frontmatter` (auto-apply).
  - Leading queries: `get_context` (semantic retrieval), `get_vault_tree` (folder/file structure)
  - Follow-up queries: `read_note` (exact text + frontmatter), `get_typed_links` (typed-link graph)
- Recommended flow:
  1. Use `get_context` to collect candidate notes (write your query as a full sentence for reproducibility).
  2. Use `read_note` to confirm exact wording and frontmatter.
     - Note: `read_note` does **not** search by title/id; it reads by vault-relative `path`.
     - If you only know `id`/`title`, use `resolve_note` (preferred) or `search_notes` to find candidate paths first, then `read_note`.
  3. Use `get_typed_links` (outgoing only) to check for missing relationships and navigation gaps.
  4. Use the typed-links coverage checklist (see `./typed-links.md`) to fill obvious omissions.
  5. Use `edit_note` for edits and `relocate_note` for moves/renames (`relocate_note` is still manual confirm; `edit_note` is auto-apply).
- Failure handling: record the error and cause; temporarily fall back to `rg`/`find` only if MCP calls fail.

### Tool summary

- `get_context`: semantic retrieval over indexed chunks; returns related notes and optional previews.
- `read_note`: reads a specific note from the vault filesystem (body included) to verify exact text/fields.
- `resolve_note`: resolve an id/title/wikilink target to candidate note paths (DB-backed).
- `search_notes`: DB-backed metadata filtering (frontmatter-derived fields, tags/keywords/sources); no embeddings calls.
- `list_tags`: list indexed tags and counts (use to reuse existing vocabulary).
- `list_keywords`: list indexed keywords and counts (use to reuse existing vocabulary).
- `get_typed_links`: expands outgoing typed links into a bounded graph (metadata only).
- `find_typed_link_backrefs`: find notes that link _to_ a target via typed links (incoming edges).
- `get_vault_tree`: returns a folder/file tree for vault Markdown files.
- `frontmatter_validate`: validates vault-wide frontmatter key presence + `id`/`created` consistency.
- `find_broken_links`: detects unresolved wikilinks/typed links by resolving targets against indexed notes.
- `capture_note`: creates a new note (`apply=false` preview → `apply=true` auto-apply by default).
- `edit_note`: applies line-based patch ops to a note (`apply=false` preview → `apply=true` auto-apply by default).
- `improve_frontmatter`: normalizes/adds required frontmatter keys for a note (`apply=false` preview → `apply=true` auto-apply by default).
- `relocate_note`: moves/renames a note (manual confirm; requires `apply=true`).

### Semantic retrieval guidance

- Strong directive: start any investigation/edit decision by running `get_context`.
- Base rule: use semantic retrieval (`get_context`) to gather candidates, then use `read_note` to collect literal evidence.
- Suggested flow:
  1. Write the investigation goal as a single sentence and reuse the same sentence as the `get_context` query (for reproducibility).
  2. Read at least two top results, and compare notes from different folders when possible (reduce bias).
  3. For any candidate you plan to modify, re-check via `read_note` and record both retrieval results together.
- Before final decisions: if results feel ambiguous or conflicting, verify by reading the primary note text via `read_note` before concluding.

## Checklist

- Before: gather related notes/assets (`get_context`, `rg "assets/" -n`).
- Frontmatter: verify required key presence (`id`, `created`, `title`, `summary`, `aliases`, `entity`, `layer`, `tags`, `keywords`, `status`, `updated`, `source`).
- New notes: when capturing, set non-default frontmatter via `capture_note.frontmatter` overrides (at least `entity`/`layer`/`status`/`summary` when known).
- Capture quality: write captured notes to be readable and maintainable later (not raw chat logs).
  - Title: specific and stable; default to English; add disambiguators when needed (parentheses OK for disambiguation; avoid translation parentheses — use `aliases` instead).
  - Summary: 2–5 sentences that answer “what is this note for?”
- Tags/keywords: before adding a new value, check existing vocabulary via `list_tags` / `list_keywords` and reuse when possible.
- Typed links: review the coverage checklist items (`instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `cites`, `summarizes`, `derived_from`, `explains`, `supports`, `contradicts`, `verifies`, `blocks`, `mitigates`, `measures`, `same_as`, `supersedes`).
- Coverage log: keep semantic retrieval + literal checks together (what `get_context` returned, and what `read_note` confirmed).
- Links: run `find_broken_links` (preferred) and fix unresolved targets; fall back to `rg "\\[\\[" -n` if needed.
- Assets: if a folder contains local assets, ensure a note-adjacent `assets/` folder exists (create it when adding the first asset); avoid absolute/external file paths.
- MCP: keep a log of MCP calls before summarizing/classifying/reviewing.
- After: record changed file paths and entity/layer changes.
- Rationale: confirm rationale was explained in chat (not inserted into note bodies).
