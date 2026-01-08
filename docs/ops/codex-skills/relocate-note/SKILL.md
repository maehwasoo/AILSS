---
name: ailss-relocate-note
description: A placement workflow that reads a target note in the AILSS vault, uses frontmatter enhancement and related-note evidence to choose an appropriate folder, then moves it (mv) in default apply mode.
---

# AILSS Relocate Note (note placement and move skill)

This skill reads a specific note inside the AILSS vault,  
decides **where it should live** based on AILSS folder-tree and ontology rules,  
and in default apply mode, actually moves the file (`mv`).

Apply this skill when the user asks things like “where should this note go?”, “classify and move it out of Inbox”, or “place it according to the vault structure”.

---

## 0. Preconditions

### Fixed vault path

- The target vault root is fixed to a single path:  
  `/Users/kyoungho/Obsidian/AILSS`

### Filesystem-based

- Vault-tree analysis, note reading, and moving are performed via the filesystem only.

### Write permission

- In apply mode, moving requires write permission under the vault path above.
- If permission is missing: submit an approval request; if it still fails, instruct restarting with:  
  `codex --add-dir "/Users/kyoungho/Obsidian/AILSS"`

---

## 1. Input interpretation

Read options from user input and fill defaults.

- `FILE=`: absolute path to the target note (optional)
  - If `FILE=` is omitted, auto-extract absolute `.md` paths from the user arguments.
  - If exactly one absolute path exists, treat it as `FILE`.
  - If no absolute path exists, ask for a path and do not proceed.
  - If 2+ absolute paths exist, ask the user to specify which file to place via `FILE=`.
- `MODE=`: `apply` or `suggest`
  - Default is `apply`.
- `TOP_K=`: number of related-note candidates (default 5)
- `TARGET_HINT=`: optional hint for the desired target folder
  - Example: `TARGET_HINT=\"30. Resources\"`
- `CONFIRM=`: `true` or `false`
  - Default is `true`.
  - Even in apply mode, always confirm right before moving.

In short: you may omit the `FILE=` keyword, but you must provide a target file path.

---

## 2. Overall flow (reuse existing skills)

This skill reuses the two skills below as prerequisite steps.

1. `ailss-frontmatter-improve`
   - Enhance target note frontmatter to match the AILSS schema and normalize entity/layer/tags.
2. `ailss-related-notes-link`
   - Find notes related to the target, generate typed-link candidates, and apply them in apply mode.

In other words: “enhance identity → gather related evidence → decide placement → move”.

---

## 3. Placement decision procedure

### 3.1 Read the target note

1. Read `FILE` and split frontmatter and body.
2. Run `ailss-frontmatter-improve` in apply mode first to refresh metadata.
3. From the updated frontmatter, collect:
   - `title`, `summary`
   - `entity`, `layer`
   - `tags`
   - typed links (`part_of`, `instance_of`, `depends_on`, `uses`, `implements`, `see_also`)

### 3.2 Build a vault tree map

From the vault root, scan only to about depth 2 to build a map of “top-level folders and major hub notes”.

Recommended commands:

- `ls "/Users/kyoungho/Obsidian/AILSS"`
- `find "/Users/kyoungho/Obsidian/AILSS" -maxdepth 2 -type d`

At minimum, confirm the following top-level folders exist:

- `0. System`
- `1. Main`
- `10. Projects`
- `20. Areas`
- `30. Resources`
- `40. Archives`
- `100. Inbox`
- `101. Need to Review`

### 3.3 First-pass target folder candidates (rule-based)

Choose the initial candidate(s) based on frontmatter `entity` and `layer`.

#### Default rules

- If `entity` is in the family of `concept`, `definition`, `pattern`, `principle`, `heuristic`, `idea`, `method`:
  - If `layer` is `conceptual` or `logical`: prefer `30. Resources`
  - If `layer` is `operational`: prefer `20. Areas` or an operational folder under a related project
- If `entity` is `project`, or `part_of` points to a specific project hub:
  - Prefer `10. Projects/<that project>/`
- If `entity` is an artifact like `document`, `artifact`, `software`, `tool`, `dataset` and `layer` is `physical`:
  - If there is a related project/area, place it under that folder
  - Otherwise place it under an appropriate subfolder of `30. Resources`
- If `entity` is an execution record like `log`, `event`, `task`, `procedure`, `review`, `meet`, `deploy`, `rollback`:
  - If the related project/area is clear, place it under an operational folder there
  - If unclear, keep it in `100. Inbox` and defer classification
- If `tags` includes `inbox` or the current path is `100. Inbox`:
  - **Prefer moving to `101. Need to Review`**, or keep in Inbox if the user wants

#### TARGET_HINT handling

- If `TARGET_HINT` exists, it overrides the rule-based candidates.
- If the hint does not match a top-level folder name, warn and normalize to the closest folder.

### 3.4 Second-pass evidence (related notes)

Run `ailss-related-notes-link` to obtain related notes (TOP_K) and relationship keys.

Use this related evidence to adjust the first-pass candidate:

- If related notes cluster under a specific project folder → move under that project
- If related notes point to a specific Areas hub → move under that Area
- If related evidence is unclear → keep the first-pass candidate

### 3.5 Confirm the final target path

1. Confirm a single final target folder.
2. Keep the filename aligned with the existing title; if it conflicts in the folder, add a numeric suffix.
3. After moving, if `part_of` should point to a new hub note, include that as part of the plan.

Output the final target in this format first:

- Target folder: `...`
- Target file path: `...`
- Reason: summary of rule-based reasoning + related-note evidence
- Frontmatter diff to be applied

---

## 4. MODE behavior

### 4.1 apply (default)

1. Show the confirmed target path; if `CONFIRM=true`, ask for final confirmation.
2. After confirmation, move the file via `mv`.
3. After moving:
   - If needed, run `ailss-frontmatter-improve` once more in apply mode to reconcile path/part_of consistency.
4. If moving fails: request approval; if it still fails, switch to suggest mode and output manual move instructions.

### 4.2 suggest

- Do not move the file; output only the target path, reasons, and the applicable patch.

---

## 5. Final report

- Final location and filename
- One-line rationale for entity and layer
- Summary of typed-link changes after moving
- Remaining risks (e.g., broken links) and suggested follow-up checks
