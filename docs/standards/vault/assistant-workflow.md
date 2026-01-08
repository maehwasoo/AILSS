# AILSS Obsidian Vault working rules

This document defines the global working rules for the AILSS Obsidian vault. It reflects the vault structure as of **2025-11-11** and includes improvement guidance.

## Related docs

- Vault structure: `./vault-structure.md`
- Frontmatter schema: `./frontmatter-schema.md`
- Typed links: `./typed-links.md`
- Index: `./README.md`

## TL;DR

- Break down every request with sequential thinking (step-by-step reasoning) and do not execute until `nextThoughtNeeded=false`.
- For any claim grounded in a single web page/document, retrieve the original text via Fetch. For vault knowledge, query AILSS MCP first.
- Split notes into frontmatter (metadata) and body (content), and record semantic relations only as typed links in frontmatter.
- After semantic analysis, review and add any typed links that should exist (don’t stop at the existing ones).
- Use wikilinks freely in the body, but check for broken links before and after work.
- Keep assets in a note-adjacent `assets/` folder and embed them via relative paths.
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
  - Use read-first by default. Writes require explicit approval (use `apply=true` only after preview).
  - Leading queries: `get_context` (semantic retrieval), `get_vault_tree` (folder/file structure)
  - Follow-up queries: `read_note` (exact text + frontmatter), `get_typed_links` (typed-link graph)
- Recommended flow:
  1. Use `get_context` to collect candidate notes (write your query as a full sentence for reproducibility).
  2. Use `read_note` to confirm exact wording and frontmatter.
  3. Use `get_typed_links` (incoming/outgoing) to check for missing relationships and navigation gaps.
  4. Use the typed-links coverage checklist (see `./typed-links.md`) to fill obvious omissions.
  5. Use `edit_note` for edits and `relocate_note` for moves/renames (both require `apply=true` approval).
- Failure handling: record the error and cause; temporarily fall back to `rg`/`find` only if MCP calls fail.

### Tool summary

- `get_context`: semantic retrieval over indexed chunks; returns related notes and optional previews.
- `read_note`: reads a specific note from the vault filesystem (body included) to verify exact text/fields.
- `get_typed_links`: expands typed links (incoming + outgoing) up to 2 hops (metadata only).
- `get_vault_tree`: returns a folder/file tree for vault Markdown files.
- `frontmatter_validate`: validates vault-wide frontmatter key presence + `id`/`created` consistency.
- `capture_note`: creates a new note (requires `apply=true` approval).
- `edit_note`: applies line-based patch ops to a note (requires `apply=true` approval).
- `relocate_note`: moves/renames a note (requires `apply=true` approval).

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
- Typed links: review the coverage checklist items (`instance_of`, `part_of`, `depends_on`, `uses`, `implements`, `cites`, `same_as`, `supersedes`).
- Coverage log: keep semantic retrieval + literal checks together (what `get_context` returned, and what `read_note` confirmed).
- Links: open `rg "\[\[" -n` results and fix unresolved wikilinks.
- Assets: ensure a note-adjacent `assets/` folder exists; avoid absolute/external file paths.
- Structure: keep H1 equal to filename; use H2–H4 for most content.
- MCP: keep a log of MCP calls before summarizing/classifying/reviewing.
- After: record changed file paths and entity/layer changes.
- Rationale: confirm rationale was explained in chat (not inserted into note bodies).
