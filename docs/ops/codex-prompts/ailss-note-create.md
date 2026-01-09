---
description: Create an AILSS-formatted note via MCP capture_note (dry-run first)
argument-hint: TOPIC=... FOLDER=... TAGS=tag1,tag2 KEYWORDS=kw1,kw2
mcp_tools:
  - get_context
  - capture_note
---

Create a new Obsidian note in the AILSS vault using MCP write tools.

Workflow:

1. Call `get_context` using the TOPIC (or an inferred query) to avoid duplicates and reuse existing terminology.
2. Draft the note:
   - Title: concise and specific.
   - Frontmatter: let `capture_note` generate `id`/`created`/`updated`; only set safe fields like `summary`, `tags`, `keywords`.
   - Body: short summary, key points, next actions/open questions, then relevant wikilinks.
3. Call `capture_note` with `apply=false` first to preview the resulting path + sha256.
4. Ask the user for confirmation before calling `capture_note` again with `apply=true`.

User input:

$ARGUMENTS
