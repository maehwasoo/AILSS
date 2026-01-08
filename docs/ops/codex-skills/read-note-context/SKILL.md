---
name: ailss-read-note-context
description: Procedure to read an AILSS vault note from an absolute path, summarize its frontmatter and core body, and add it to the current working context.
---

# AILSS Read Note Context (note context loading skill)

This skill reads an absolute path to an AILSS vault note provided by the user,  
summarizes frontmatter metadata and the body’s key points, and **adds it to the current working context**.

Apply this skill when the user asks things like “read this note and load it into context” or “I’ll give you a file path—read it”.

---

## 0. Preconditions

- The vault root is fixed:  
  `/Users/kyoungho/Obsidian/AILSS`
- This skill is **read-only**. Do not edit or move files.

---

## 1. Input interpretation

- `FILE=`: one or more absolute paths to target notes (optional)
  - If `FILE=` is omitted, **auto-extract all absolute `.md` paths** from the user arguments.
  - If one or more absolute paths are extracted, treat that list as `FILE`.
  - If no absolute path is found, ask the user for a path.
  - If `FILE=` is present, it takes precedence over auto-extraction.
- `EXTRACT=`: `frontmatter` | `summary` | `full`
  - Default is `summary`.

In short: you may omit the `FILE=` keyword, but you still need at least one absolute path to read.

---

## 2. Procedure

### 2.1 File validation

1. Confirm each `FILE` is a `.md` file.
2. Confirm each path is under the vault root.
   - If not, warn and ask whether to continue reading.

### 2.2 Read file

1. Split frontmatter and body.
2. Summarize frontmatter while preserving key-value fields.
3. Compress the body to key points only.
   - Prioritize extracting: purpose, problem, key claims, decisions, TODOs, and references.

### 2.3 Output by EXTRACT mode

- `frontmatter`:
  - Summarize only frontmatter fields in a table-like format.
- `summary` (default):
  - Provide a frontmatter summary + a 5–10 line core summary of the body.
  - Add a 1–3 line note on how it affects the current work.
- `full`:
  - Show frontmatter as-is; for a long body, split and present it by sections.

---

## 3. Final report

- List of file paths read
- One-line summary per file
- Connection points to the current work
