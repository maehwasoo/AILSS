---
name: ailss-frontmatter-improve
description: Procedure to automatically enhance an AILSS vault note’s front matter to match the schema, and update the file directly in default apply mode.
---

# AILSS Frontmatter Improve (frontmatter enhancement skill)

This skill reads a specific note (a Markdown file) inside the AILSS vault and,  
according to the AILSS frontmatter schema, performs **missing-field completion, value normalization, and applying typed-link candidates**, then **edits the file directly in default apply mode**.

Apply this skill when the user asks things like “enhance the frontmatter”, “make it match the AILSS schema”, or “clean up the note metadata”.

---

## 0. Preconditions

### Fixed vault path

- The target vault root is fixed to this single path:  
  `/Users/kyoungho/Obsidian/AILSS`

### File system write permission

- Codex must be able to write under the vault path above.
- If permission is missing:
  1. submit an approval request, and
  2. if it still fails, instruct the user to retry after exposing the vault path like this:  
     `codex --add-dir "/Users/kyoungho/Obsidian/AILSS"`

---

## 1. Input interpretation

If the user input includes options below, **apply them with priority**; otherwise use defaults.

- `FILE=`: absolute path to the target note (optional)
  - If `FILE=` is omitted, **auto-extract absolute `.md` file paths** from the user arguments.
  - If exactly one absolute path exists, treat it as `FILE`.
  - If no absolute path exists, ask the user for a path.
  - If 2+ absolute paths exist, ask the user to specify which one using `FILE=`.
- `MODE=`: `apply` or `suggest`
  - Default is `apply`.
- `ENTITY=`, `LAYER=`, `TAGS=`, `KEYWORDS=`, and typed links (`PART_OF=`, `DEPENDS_ON=`, `USES=`, `IMPLEMENTS=`, `SEE_ALSO=`) should be reflected if present.

In short: you may omit the `FILE=` keyword, but **the target file path itself is required**.

---

## 2. Procedure

### 2.1 Read and validate file

1. Confirm `FILE` is a `.md` file.
2. Confirm the path is under the vault root. If not, warn and ask whether to continue.
3. Read the file and split YAML frontmatter and body.

### 2.2 Parse and recover frontmatter

1. If there is no frontmatter, prepare to create one.
2. If frontmatter exists but YAML parsing fails:
   - First fix and recover common issues: indentation, colons, list syntax.
   - If recovery is impossible, report the error location and reason, then stop.

### 2.3 Align to the AILSS schema

Align fields based on the default schema below.

```yaml
---
id: <YYYYMMDDHHmmss>
created: <YYYY-MM-DDTHH:mm:ss>
title: <note title>
summary: <3–5 sentence summary>
aliases: []
entity: <inferred or provided>
layer: <inferred or provided>
tags: []
keywords: []
status: draft
updated: <YYYY-MM-DDTHH:mm:ss>
instance_of: []
part_of: []
uses: []
depends_on: []
implements: []
see_also: []
---
```

#### Field completion rules

- `id`, `created`:
  - If present, keep as-is.
  - If missing, fill with the current local time.
- `updated`: always refresh to the current local time.
- `title`:
  - If option `TITLE=` exists, use that value.
  - Otherwise, use the H1 title if present; if not, use the filename.
- `summary`:
  - Compress the body into 3–5 sentences and fill it.
- `aliases`, `keywords`:
  - If a value exists, keep it; if it is not an array, normalize to an array.
  - Add only high-confidence candidates, in the range 0–5 items.
- `entity`, `layer`:
  - If options exist, use them directly.
  - Otherwise infer using the AILSS classification rules based on the body and file path.
  - If uncertain, default to `entity: document`, `layer: conceptual`.
- `tags`:
  - Keep existing tags and normalize to an array.
  - If the `FILE` path contains `/100. Inbox/`, merge in the `inbox` tag.
- typed links:
  - Extract candidates from body wikilinks and noun phrases.
  - Merge with existing arrays and remove duplicates.
  - Avoid over-linking: keep roughly 0–5 items per relation key, and sort lexicographically.

### 2.4 Generate changes

- Summarize the difference between existing and new frontmatter as a diff.
- By default do not change the body, but it is acceptable to add an H1 when missing and the title does not match.

---

## 3. MODE behavior

### 3.1 apply (default)

1. Generate the new file content including updated frontmatter.
2. Overwrite and save the original file.
3. If saving fails: request approval; if it still fails, switch to suggest mode and output a patch.

### 3.2 suggest

- Do not edit the file; output only an applicable patch (diff) and the reasons.

---

## 4. Final report

Report briefly:

- List of modified fields and key reasons
- One-line rationale for the chosen entity and layer
- Added typed-link candidates and the evidence
