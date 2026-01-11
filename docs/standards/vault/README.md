# Vault rules (AILSS Obsidian vault)

This folder contains the **canonical rules** for how knowledge is modeled and maintained in the AILSS Obsidian vault.

The rules are split into topic-scoped docs so they stay navigable and can be referenced from code, tests, and prompts without drift.

## Topics

- Assistant workflow (how an LLM should operate + MCP usage): `./assistant-workflow.md`
- Frontmatter schema (identity fields, entity/layer/status, templates): `./frontmatter-schema.md`
- Typed links (frontmatter relations as graph edges): `./typed-links.md`
- Vault structure (folders, naming, wikilinks): `./vault-structure.md`
- Note style (optional Markdown/language conventions): `./note-style.md`

## Prompt installer

The Obsidian plugin “Prompt installer (vault root)” stitches these docs into a single prompt file (for example `AGENTS.md`) and writes it to the vault root.
