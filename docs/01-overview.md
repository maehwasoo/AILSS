# System overview

This document describes the full AILSS flow by splitting the system into **three parts**.

## 1) Indexer

Responsibilities:

- Read Markdown files from the vault via the file system.
- Chunk content and generate embeddings.
- Store embeddings + metadata in a local DB (e.g., SQLite).

Output (example):

- `chunk_id`, `path`, `heading`, `front matter`, `hash`, `embedding vector`, `text`

## 2) MCP server

Responsibilities:

- Query the local DB and return search/recommendation results.
- Start with read-only tools by default.

Example tools:

- `semantic_search`: query → return related notes/chunks
- `get_note`: by path → return note content/metadata
- `suggest_typed_links`: suggest typed-link candidates
- `find_broken_links`: detect broken links

## 3) Obsidian plugin

Responsibilities:

- Display recommendations in a UI.
- Only perform actual changes when the user clicks an explicit “Apply” action.
- Applying changes can be implemented either by (A) calling existing scripts or (B) editing via an Obsidian Vault API.

## Data boundary

- Indexing = file read + DB write
- Recommendation = DB read
- Apply = file write; requires explicit user action
