---
name: ailss-related-notes-link
description: Linking workflow that finds notes related to the current note in the AILSS vault via filesystem search, and applies typed links automatically in default apply mode.
---

# AILSS Related Notes Link (related-note linking skill)

This skill finds **candidate related notes** in the AILSS vault for a target note, recommends typed-link relationships, and **automatically applies them to frontmatter in default apply mode**.

Apply this skill when the user asks things like “find and link related notes”, “fill see_also”, or “suggest part_of / depends_on candidates”.

---

## 0. Preconditions

- The vault root is fixed:  
  `/Users/kyoungho/Obsidian/AILSS`
- Both searching and writing are performed via the filesystem.
- If write permission is missing: request approval; if it still fails, instruct restarting with `codex --add-dir "/Users/kyoungho/Obsidian/AILSS"`.

---

## 1. Input interpretation

Read options and fill defaults.

- `FILE=`: absolute path to the target note (optional)
  - If `FILE=` is omitted, auto-extract absolute `.md` paths from user arguments.
  - If exactly one absolute path exists, treat it as `FILE`.
  - If no absolute path exists, ask the user for a path.
  - If 2+ absolute paths exist, ask the user to specify which one via `FILE=`.
- `TOP_K=`: number of related candidates, default 5
- `MODE=`: `apply` or `suggest`, default `apply`

In short: you may omit the `FILE=` keyword, but you must provide a target file path.

---

## 2. Procedure

### 2.1 Analyze the target note
1) Read `FILE` and split frontmatter and body.
2) Extract keyword candidates from:
   - `title`, `aliases`, `tags`, `keywords`
   - H1/H2/H3 headings
   - Repeated noun phrases and emphasized (**bold**) phrases in the body
3) Exclude overly generic words and keep ~5–15 keywords.

### 2.2 Search the vault
1) Combine 2–4 keywords and run a string search over the whole vault.
   - When possible, use a command like `rg "<keyword>" "/Users/kyoungho/Obsidian/AILSS"`.
2) Add notes whose path/filename contains keywords as candidates as well.
3) Exclude the current note itself and exact duplicates.

### 2.3 Score candidates and select TOP_K
Score each candidate using signals like:
- Title or frontmatter matches directly
- The notes mention each other in their bodies
- They share folder hierarchy or are grouped under an upper hub note
- They share the same entity or layer

Keep only the top `TOP_K`.

### 2.4 Recommend typed-link relationships
For each candidate, recommend 1 appropriate key from:
- `part_of`: when folder structure or topics look like parent-child
- `instance_of`: when the target is an instance of a broader type
- `depends_on`: when technical/conceptual dependency is clear
- `uses`: when it uses a tool/resource
- `implements`: when it follows/implements a spec or policy
- `see_also`: when strongly related but not clearly hierarchical/dependent

For each recommendation, explain “why this relationship” in 1–3 lines.

---

## 3. MODE behavior

### 3.1 apply (default)
1) Merge candidates into the relevant array(s) in the target note’s frontmatter.
2) Deduplicate and sort lexicographically.
3) Save only the changed frontmatter (default: do not touch the body).
4) If saving fails: request approval; if it still fails, switch to suggest mode and output a patch.

### 3.2 suggest
- Output only the array values you would add to frontmatter and the evidence; do not edit the file.

---

## 4. Final report

- Selected candidate list (TOP_K)
- For each candidate: recommended relationship key and evidence
- In apply mode: the actual frontmatter diff that was written
