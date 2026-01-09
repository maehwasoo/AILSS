---
name: ailss-capture
description: Capture workflow that summarizes the current Codex CLI conversation into AILSS Obsidian-vault-compliant frontmatter and body, then saves it under the `100. Inbox` folder.
---

# Obsidian Capture for AILSS (Codex conversation capture skill)

This skill summarizes the **entire current conversation** from the Codex CLI session and,  
while respecting the AILSS Obsidian vault’s frontmatter schema, saves it as a Markdown note under:  
`/Users/kyoungho/Obsidian/AILSS/100. Inbox/`.

Use this skill when the user asks for `ailss-capture`, “summarize the conversation and save to Inbox”, “capture this”, etc.

---

## 0. Preconditions

For now, **save via filesystem only**.

### Filesystem-saving prerequisites

- Codex must be able to write under `/Users/kyoungho/Obsidian/AILSS`.
  - If that path is not a writable root in the current session, request approval when saving.
  - If the user does not approve or permissions keep failing, request one of:
    1. Restart Codex while exposing the vault path:  
       `codex --add-dir "/Users/kyoungho/Obsidian/AILSS"`
    2. Or save to a temporary location and output the path so the user can move it manually.

Once permissions are available, proceed with the workflow below.

---

## 1. Input interpretation

If user options are present, **apply them with priority**; otherwise infer defaults.

- `TITLE=`: note title
- `ENTITY=`: entity value
- `LAYER=`: layer value
- `TAGS=`: tag list, comma-separated
- `KEYWORDS=`: keyword list, comma-separated
- typed-link candidates like `PART_OF=`, `DEPENDS_ON=`, `USES=`, `IMPLEMENTS=`, `SEE_ALSO=`, etc.

If options are not provided as key=value pairs, infer from the conversation content.

---

## 2. Generate a conversation summary

### 2.1 Summary scope

- Target **the entire user+assistant conversation** in the current session.
- Ensure it includes code changes, skill usage, conclusions, and next actions.

### 2.2 Required sections

The summary must include:

1. **One-paragraph overview (summary)**
   - 3–5 sentences, focused on “what was done and why”.
2. **Key decisions / conclusions**
   - Chosen direction, reasoning, and briefly what alternatives were excluded.
3. **What we did**
   - Files created, settings changed, tools used.
4. **Next actions**
   - 3–8 checkbox TODOs.
5. **References**
   - Important links and file paths mentioned in the conversation.

---

## 3. Write frontmatter

### 3.1 AILSS schema (base template)

Keep the fields below, but instead of templater placeholders like `{{date:...}}`, **fill and save real values**.

```yaml
---
id: <YYYYMMDDHHmmss>
created: <YYYY-MM-DDTHH:mm:ss>
title: <note title>
summary: <3–5 sentence summary>
aliases: []
entity: <inferred or provided>
layer: <inferred or provided>
tags: ["inbox"]
keywords: []
status: draft
updated: <YYYY-MM-DDTHH:mm:ss>
source: []
---
```

### 3.2 Field fill rules

- `id`: numeric string `YYYYMMDDHHmmss` based on local current time.
- `created`, `updated`: local current time in ISO-8601.
- `title`:
  - If `TITLE=` is provided, use it as-is.
  - Otherwise, summarize the core topic of the conversation into a 1-line title.
  - Since it may also be used in the filename, remove path characters like `/`.
- `summary`: use the “one-paragraph overview” from 2.2 as-is.
- `aliases`: only if clearly present in the conversation; keep it to 1–3 items.
- `entity`, `layer`:
  - If options are provided, use them as-is.
  - Otherwise default to `entity: log`, `layer: operational`.
  - If the conversation is purely conceptual/definitions, adjust to `conceptual`; if it is centered on implementation files/config, adjust to `physical`.
- `tags`:
  - Default is `['inbox']`.
  - If `TAGS=` is provided, merge while keeping `inbox`.
- `keywords`, typed links:
  - Apply options if provided.
  - Otherwise keep only high-confidence items, minimized to 0–5.
  - For typed links: only include the relation key when you have at least one value (omit empty arrays), and keep them below `source`.

---

## 4. Write the body

Follow the AILSS note skeleton, filled to match the conversation summary.

```markdown
# <title>

## Summary

<same as frontmatter summary, or expand by 1–2 sentences>

## Context

- problem / goal
- why this conversation started
- scope / constraints

## Key content

- important ideas and process
- skills/prompts created, config changes
- key code/commands

## Decisions

- decisions made
- alternatives and why they were chosen/rejected

## Follow-ups

- [ ] TODO 1
- [ ] TODO 2

## References

- links / file paths
```

Do not use middle-dot separators; use commas or hyphens instead.

---

## 5. Save the note

### 5.1 Save path

- Always save under:
  - `/Users/kyoungho/Obsidian/AILSS/100. Inbox/`

### 5.2 Filename rules

- Default filename: `<title>.md`
- Minimize spaces/special characters; keep parentheses only when needed for title disambiguation.

### 5.3 Execution

1. **Prefer direct write**
   - Create a Markdown file at the target path and write the full content.
   - If permissions are required, request approval first.
2. **Fallback when direct write fails**
   - Save first to a temporary file under the current working directory (cwd).
   - Then move via `mv` to `/Users/kyoungho/Obsidian/AILSS/100. Inbox/`.
   - If moving also requires permissions, request approval.
3. If both steps fail, report the failure reason and the temporary file path, and instruct the user how to move it manually.

---

## 6. Final report

After saving, report briefly:

- Saved path and filename
- One-line reasoning for entity/layer selection
- 2–3 key TODOs
