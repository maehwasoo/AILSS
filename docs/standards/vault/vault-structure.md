# Vault structure

## Top-level folders

- Required top-level folders: `10. Projects`, `20. Areas`, `30. Resources`, `40. Archives`, `100. Inbox`.
- Optional top-level folders (convenience): `0. System`, `1. Main` (and any additional folders you introduce intentionally).

## Immediate improvement actions

- Bulk-add frontmatter to notes that do not use the template yet (see templates in `./frontmatter-schema.md`).
- For notes under `10. Projects/10. HouMe/OLD/`, standardize first as `entity: document`, `layer: physical`, then reclassify later if needed.
- For each unit of work, check broken wikilinks via `rg "\\[\\[" -n`, and move assets into a note-adjacent `assets/` folder.

This document summarizes the AILSS vault structure, naming, and linking conventions (and how they map into typed links and frontmatter).

## Naming and asset placement

- Filenames: default to an English title (example: `Domain-Driven Design.md`). Avoid adding translations in parentheses (e.g. `한글(English)`); use parentheses only for disambiguation.
  - If you want searchable alternate titles/translations (e.g. Korean), put them in frontmatter `aliases` instead.
- Filenames (cross-device safe): avoid characters/sequences that can break links or Sync on other OSes.
  - Avoid: `\\` `/` `:` `*` `?` `"` `<` `>` `|` `#` `^` and `%%` / `\[\[` / `\]\]`.
  - Prefer using only letters/numbers/spaces plus `-` and `_` when in doubt.
- Keep assets in a note-adjacent `assets/` folder and embed via relative paths (example: `20. Areas/50. AILSS/assets/diagram.png`).
- After moving a path/file, check for broken links via `rg "\\[\\[" -n`.

### Folder creation and naming rules

- Folder naming: two-digit prefix + space + English title (example: `12. Data Quality`). Avoid adding translations in parentheses (e.g. `한글(English)`); use parentheses only for disambiguation.
- Apply the same rule to subfolders, but keep the maximum depth to 3 levels from the top-level folder.
  - Example: `12. Data Quality/20. Monitoring`
- When creating a new folder, also create an `assets/` subfolder, and embed assets only via relative paths.
- The first note in a folder should be a hub note, and the filename should match the folder name.
  - Suggested frontmatter: `entity: hub`, `layer: logical`, `instance_of: ['\[\[hub]]']`, `part_of: ['\[\[parent hub]]']`
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

## Wikilinks, anchors, and footnotes

- Wikilinks: use `\[\[Note title]]` by default; use `\[\[Note title|Display text]]` when display text should differ.
- In these rules docs, prefer explicit display text and hide the path by using `\[\[path/to/note|Title]]`.
  - Example: `\[\[20. Areas/30. SOPT/코드 리뷰/PROMPT|PROMPT]]`
  - Example: `\[\[20. Areas/70. Claude Code/Commands/write-pr|write-pr]]`
- Heading anchors: use `\[\[Note#Section]]`; if section names change, update links too.
- Block references: attach `^id` to the smallest quote-worthy block and reference via `\[\[Note#^id]]`.
- Footnotes: use `[^key]` in the body and define at the bottom as `[^key]: ...` (use short meaningful keys).
- Link checking: before/after work, check broken wikilinks via `rg "\\[\\[" -n`.
