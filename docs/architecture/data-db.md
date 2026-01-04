# Architecture: data & database

This document describes the index DB schema and the indexing/search flow.

## DB location

- Default: `<vault>/.ailss/index.sqlite`
- Creation logic: `@ailss/core` `resolveDefaultDbPath(vaultPath)`

## DB components

### `files` table

Stores file-level metadata.

- `path` (PK): vault-relative path
- `mtime_ms`, `size_bytes`
- `sha256`: content hash

### `chunks` table

Stores chunk-level text and metadata.

- `chunk_id` (PK)
- `path` (FK → `files.path`)
- `heading`, `heading_path_json`
- `content`, `content_sha256`

### `chunk_embeddings` (`vec0`)

A sqlite-vec `vec0` virtual table for vector search.

- `embedding FLOAT[dim]`

### `chunk_rowids`

Stores a mapping between `chunks.chunk_id` and `chunk_embeddings.rowid`.

## Indexing flow

1. Scan for `.md` files in the vault (default ignores: `.obsidian`, `.git`, `.trash`, `.ailss`, etc.)
2. Compare the file sha256 to the DB; if it differs, treat as “changed”
3. Upsert `files`, and clear prior `chunks` / `chunk_rowids` / `chunk_embeddings` rows for that file
4. Chunk the Markdown body by headings (with `maxChars`)
5. Generate embeddings via the OpenAI embeddings API (batched calls)
6. Insert `chunks`, `chunk_embeddings`, and `chunk_rowids`

## Search flow

- `semantic_search` embeds the query and performs a KNN search via sqlite-vec using `MATCH` + `k = ?`
- Due to sqlite-vec constraints, the KNN query needs `k = ?` or `LIMIT`, so matches are separated with a CTE

## Embedding dimension caveat

- Embedding dimensions vary by model
- `chunk_embeddings` fixes the dimension at DB creation time, so changing the model may require recreating the DB
