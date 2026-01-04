# Implementation plan

This document lists an implementation sequence that starts small and then expands.

## 0) Confirm assumptions / decisions

- Support scope: decide whether this is desktop-first only, or includes mobile.
- Write scope: decide whether this is “recommendation only” or includes “file edits” (default recommendation-only is preferred).
- Vault path: decide whether the vault lives inside the repo or is configured as an external path.

## 1) Design the index schema

- File level: `path`, `mtime`, `size`, `hash`
- Chunk level: `chunk_id`, `start/end`, `heading`, `text`, `embedding`
- Links: outgoing/incoming, type

## 2) Indexer MVP

- Markdown parsing + heading-based chunking
- Incremental updates based on file hash
- SQLite storage (vector index to be added later)

## 3) MCP server MVP

- Provide `semantic_search` (topK) + `get_note`
- Include explanations in results (chunk path/heading/snippet)

## 4) Obsidian plugin MVP

- Recommendation list UI
- Keep “Apply” disabled at first, or limit it to calling existing scripts

## 5) Integration / operations

- Local config (API key, vault path)
- Privacy documentation + opt-in options
