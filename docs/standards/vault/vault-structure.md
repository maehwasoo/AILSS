# Vault structure

## Top-level folders

Canonical top-level folders (English, prompt-safe):

| Folder          | Required | Role                                                     |
| --------------- | -------- | -------------------------------------------------------- |
| `10. Projects`  | Yes      | time-bounded projects and decisions                      |
| `20. Areas`     | Yes      | long-lived responsibility areas                          |
| `30. Resources` | Yes      | reference material and external summaries                |
| `40. Archives`  | Yes      | inactive/finished material                               |
| `100. Inbox`    | Yes      | capture inbox; triage regularly                          |
| `0. System`     | No       | system rules, templates, scripts, and operational guides |
| `1. Main`       | No       | top-level hubs and navigation indexes                    |

Notes:

- AILSS does **not** auto-rename/migrate existing vault folders.
- If your inbox folder name differs, pass `folder` explicitly when calling `capture_note` (default: `100. Inbox`).

### Non-canonical examples (avoid → use)

| Avoid                                               | Use                  | Context                                          |
| --------------------------------------------------- | -------------------- | ------------------------------------------------ |
| localized/non-English folder names                  | English folder names | keep paths stable and prompt examples consistent |
| inconsistent spacing/punctuation (e.g. `100.Inbox`) | `100. Inbox`         | canonical inbox folder name                      |

## Immediate improvement actions

- Bulk-add frontmatter to notes that do not use the template yet (see templates in `./frontmatter-schema.md`).
- For notes under `10. Projects/10. HouMe/OLD/`, standardize first as `entity: document`, `layer: physical`, then reclassify later if needed.
- For each unit of work, check broken wikilinks via `rg "\\[\\[" -n`, and move assets into a note-adjacent `assets/` folder.

This document summarizes the AILSS vault structure, naming, and linking conventions (and how they map into typed links and frontmatter).

## Naming and asset placement

- Filenames: default to an English title (example: `Domain-Driven Design.md`). Avoid adding translations in parentheses (e.g. `Korean(English)`); use parentheses only for disambiguation.
  - If you want searchable alternate titles/translations (e.g. Korean), put them in frontmatter `aliases` instead.
- Filenames (cross-device safe): avoid characters/sequences that can break links or Sync on other OSes.
  - Avoid: `\\` `/` `:` `*` `?` `"` `<` `>` `|` `#` `^` and `%%` / Obsidian wikilink brackets.
  - Prefer using only letters/numbers/spaces plus `-` and `_` when in doubt.
- Keep assets in a note-adjacent `assets/` folder and embed via relative paths (example: `20. Areas/50. AILSS/assets/diagram.png`).
- After moving a path/file, check for broken links via `rg "\\[\\[" -n`.

### Folder creation and naming rules

- Folder naming: two-digit prefix + space + English title (example: `12. Data Quality`). Avoid adding translations in parentheses (e.g. `Korean(English)`); use parentheses only for disambiguation.
- Apply the same rule to subfolders, but keep the maximum depth to 3 levels from the top-level folder.
  - Example: `12. Data Quality/20. Monitoring`
- When creating a new folder, also create an `assets/` subfolder, and embed assets only via relative paths.
- The first note in a folder should be a hub note, and the filename should match the folder name.
  - Suggested frontmatter (example below)
- After folder moves/creation, re-check broken links and update child notes’ `part_of` to the new hub note.

```yaml
entity: hub
layer: logical
instance_of: ["[[hub]]"]
part_of: ["[[parent hub]]"]
```

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

- Wikilinks: use the note title by default; use display text when it should differ.
- In these rules docs, prefer explicit display text and hide the path via display text.
- Heading anchors: use note + heading; if section names change, update links too.
- Block references: attach `^id` to the smallest quote-worthy block and reference it.
- Footnotes: use `[^key]` in the body and define at the bottom as `[^key]: ...` (use short meaningful keys).
- Link checking: before/after work, check broken wikilinks via `rg "\\[\\[" -n`.

Examples:

```md
[[Note title]]
[[Note title|Display text]]
[[path/to/note|Title]]
[[20. Areas/30. SOPT/Code Review/PROMPT|PROMPT]]
[[20. Areas/70. Claude Code/Commands/write-pr|write-pr]]
[[Note#Section]]
[[Note#^id]]
```
