# Vault structure

## Related docs

- Assistant workflow: `./assistant-workflow.md`
- Frontmatter schema: `./frontmatter-schema.md`
- Typed links: `./typed-links.md`
- Index: `./README.md`

## Snapshot (2025-11-11)

- Required top-level folders: `10. Projects`, `20. Areas`, `30. Resources`, `40. Archives`, `100. Inbox`.
- Optional top-level folders (convenience): `0. System`, `1. Main` (and any additional folders you introduce intentionally).
- Markdown file count: 494 total; 281 with frontmatter (about 57%). (Snapshot numbers; they may drift over time.)
- Example notes missing frontmatter (cleanup priority):
  - `0. System/Reset Frontmatter.md`
  - `10. Projects/10. HouMe/OLD/CI_빌드실패_원인분석_및_수정보고서_LoadingPage.md`
  - `10. Projects/10. HouMe/OLD/DIAGNOSIS.md`
  - `10. Projects/10. HouMe/OLD/PR_LOADING_PAGE.md`
  - `10. Projects/10. HouMe/OLD/TYPE_GUARD_NOTES.md`

## Immediate improvement actions

- Bulk-add frontmatter to notes that do not use the template yet (see templates in `./frontmatter-schema.md`).
- For notes under `10. Projects/10. HouMe/OLD/`, standardize first as `entity: document`, `layer: physical`, then reclassify later if needed.
- For each unit of work, check broken wikilinks via `rg "\\[\\[" -n`, and move assets into a note-adjacent `assets/` folder.

This document summarizes the AILSS ontology, layers, and Obsidian conventions (and how they map into typed links and frontmatter).

## Naming and asset placement

- Filenames should use a Korean title with optional English in parentheses (example: `도메인 주도 설계(Domain-Driven Design).md`).
- Keep assets in a note-adjacent `assets/` folder and embed via relative paths (example: `20. Areas/50. AILSS/assets/diagram.png`).
- After moving a path/file, check for broken links via `rg "\\[\\[" -n`.

### Folder creation and naming rules

- Folder naming: two-digit prefix + space + Korean title + optional English in parentheses (example: `12. 데이터 품질(Data Quality)`).
- Apply the same rule to subfolders, but keep the maximum depth to 3 levels from the top-level folder.
  - Example: `12. 데이터 품질/20. 모니터링(Monitoring)`
- When creating a new folder, also create an `assets/` subfolder, and embed assets only via relative paths.
- The first note in a folder should be a hub note, and the filename should match the folder name.
  - Suggested frontmatter: `entity: hub`, `layer: logical`, `instance_of: ['[[hub]]']`, `part_of: ['[[parent hub]]']`
- After folder moves/creation, re-check broken links and update child notes’ `part_of` to the new hub note.

## Folder roles (vault structure principles)

- `0. System` (optional) — system rules, templates, scripts, and operational guides (mostly physical).
- `1. Main` (optional) — top-level hubs and navigation indexes.
- `10. Projects` — time-bounded projects and decisions (strategic/logical notes may coexist).
- `20. Areas` — long-lived responsibility areas (conceptual + operational mix is normal).
- `30. Resources` — reference material and external summaries (mostly conceptual).
- `40. Archives` — inactive/finished material (when moving, keep origin via `part_of`).
- `100. Inbox` — capture inbox; triage regularly.

### Structure improvement rules

- Historical/legacy project notes (under `OLD`) → standardize as `entity: document`, `layer: physical` first.
- Execution logs/events → move as `entity: log|event`, `layer: operational`.
- Shared principles/definitions/patterns → promote to `20. Areas` or `30. Resources` and classify as `entity: concept|definition|pattern`.
- After moving files, immediately check for broken links via `rg "\\[\\[" -n`.

## Note body structure guide

All notes should start with an H1 header, and the filename should match the H1.

### Common skeleton

- `# {Title}`
- `Summary` — 3–5 sentences, only the essentials.
- `Context` — background, problem, scope.
- `Core` — main content (concept/design/procedure).
- `Decision` — decisions, alternatives, criteria (tables are fine).
- `Next actions` — TODO checklist.
- `References` — sources and related links.

### Minimum sections by entity

- Concept: definition, examples, counterexamples, see also.
- Project: objectives, scope, artifacts, timeline, risks.
- Procedure: prerequisites, steps, verification criteria, rollback.
- Decision: options, criteria, selection, impact.

## Obsidian grammar rules

- Headings: use ATX `#` style only. Use H1 once; H2–H4 for most structure.
- Lists: standardize on `-` bullets; indent sub-lists with 2 spaces.
- Code: use triple backticks code fences and specify the language when possible.
- Tables: use pipe (`|`) tables and include a header row.
- Emphasis: use `**bold**` and `*italic*` sparingly (meaning-first).
- Callouts: use Obsidian defaults only (`[!NOTE]`, `[!TIP]`, `[!WARNING]`).
- Embeds: use `![[filename]]`; keep assets in a note-adjacent `assets/` folder.
- Tags: use a small number of navigation tags; promote semantic relations into typed links.
- Filenames: keep the vault filename convention consistent (see naming rule above).

## Wikilinks, anchors, and footnotes

- Wikilinks: use `[[Note title]]` by default; use `[[Note title|Display text]]` when display text should differ.
- In these rules docs, prefer explicit display text and hide the path by using `[[path/to/note|Title]]`.
  - Example: `[[20. Areas/30. SOPT/코드 리뷰/PROMPT|PROMPT]]`
  - Example: `[[20. Areas/70. Claude Code/Commands/write-pr|write-pr]]`
- Heading anchors: use `[[Note#Section]]`; if section names change, update links too.
- Block references: attach `^id` to the smallest quote-worthy block and reference via `[[Note#^id]]`.
- Footnotes: use `[^key]` in the body and define at the bottom as `[^key]: ...` (use short meaningful keys).
- Link checking: before/after work, check broken wikilinks via `rg "\\[\\[" -n`.

## Language and typography rules

- Vault notes are written in Korean using the “~해요” style.
- For technical terms, use Korean + English on first mention (example: frontmatter (metadata)).
- Record date/time in ISO-8601 format (example: `2025-11-11T10:30:00`).
- Code comments should be short, in Korean, and written as noun phrases (no sentence endings).
- Do not use the middle dot (·) anywhere (title/body/lists/tables). If you need separators, use commas, hyphens, en dashes (–), semicolons, or conjunctions instead.
