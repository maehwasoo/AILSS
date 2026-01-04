# Significance and principles

This document explains **why** the system is split (indexer/server/plugin) and **what principles** we follow.

## Significance

- Search quality: use semantic search instead of keyword search.
- Automated organization: keep frontmatter and links consistent via rules.
- Operational safety: separate “recommendation” from “apply” to reduce mistakes.
- Reuse: share the same recommendation engine between Codex CLI (via MCP) and Obsidian UI.

## Principles

- Least privilege: the MCP server is read-only by default.
- Explicit apply: any file writes happen only via explicit user action.
- Traceability: include evidence for recommendations (which chunk/rule).
- Privacy: document and control outbound data scope/options via configuration.
