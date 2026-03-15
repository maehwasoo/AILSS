# Vault rules (AILSS Obsidian vault)

This folder contains the **canonical rules** for how knowledge is modeled and maintained in the AILSS Obsidian vault.

The rules are split into topic-scoped docs so they stay navigable and can be referenced from code, tests, and prompts without drift.

## Topics

- Assistant workflow (how an LLM should operate + MCP usage): `./assistant-workflow.md`
- Frontmatter schema (identity fields, entity/layer/status, templates): `./frontmatter-schema.md`
- Typed links index (frontmatter relations entrypoint): `./typed-links.md`
- Typed links relation catalog (canonical semantics): `./typed-links-relation-catalog.md`
- Typed links decision tree (key selection guidance): `./typed-links-decision-tree.md`
- Typed links governance (SoT/change process): `./typed-links-governance.md`
- Vault structure (folders, naming, wikilinks): `./vault-structure.md`
- Note style (optional Markdown/language conventions): `./note-style.md`
- Prompt operational snapshot (concise installer source): `./prompt-operational.md`

## Prompt installer

The Obsidian plugin “Prompt installer (vault root)” writes a concise operational prompt file (for example `AGENTS.md`) from:

- `prompt-operational.md`
