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

### `db_meta` table

Stores DB identity/config values.

- `embedding_model`: the embedding model used to build the DB
- `embedding_dim`: the embedding vector dimension used to create the `vec0` table

### `chunk_embeddings` (`vec0`)

A sqlite-vec `vec0` virtual table for vector search.

- `embedding FLOAT[dim]`

### `chunk_rowids`

Stores a mapping between `chunks.chunk_id` and `chunk_embeddings.rowid`.

### `notes` table

Stores note-level metadata derived from frontmatter, plus the normalized raw frontmatter as JSON.

- `path` (PK, FK → `files.path`): vault-relative path
- `note_id`, `created`, `title`, `summary`
- `entity`, `layer`, `status`, `updated`
- `frontmatter_json`: normalized JSON (stable arrays for tags/keywords/typed links)

### `note_tags` / `note_keywords` / `note_sources`

Simple mapping tables for fast filtering without relying on sqlite JSON functions.

- `note_tags(path, tag)`
- `note_keywords(path, keyword)`
- `note_sources(path, source)`

### `typed_links`

Stores “typed links” as graph edges (frontmatter relations).

- `from_path`: vault-relative source note path
- `rel`: relation key (e.g. `part_of`, `depends_on`, `cites`)
- `to_target`: normalized wikilink target string (display text / headings removed)
- `to_wikilink`: canonical wikilink string (example below)
- `position`: ordering within the relation list

Example `to_wikilink` value:

```md
[[WorldAce]]
```

## Query support (current)

- Metadata filtering supports only a fixed set of filters backed by indexed columns/tables:
  - `notes.note_id`, `notes.entity`, `notes.layer`, `notes.status`
  - `notes.created`, `notes.updated`
  - `note_tags.tag`, `note_keywords.keyword`, `note_sources.source`
  - basic path/title filters
- Typed-link “backrefs” are supported by `rel` + `to_target`.
- The full normalized frontmatter JSON is stored, but arbitrary filtering over `frontmatter_json` is not implemented yet.

## Indexing flow

0. Open (or create) the DB and validate the embedding model/dimension identity (`db_meta`). If mismatched, stop and require a DB reset/reindex.
1. Scan for `.md` files in the vault (default ignores: `.obsidian`, `.git`, `.trash`, `.ailss`, etc.)
2. Compare the file sha256 to the DB; if it differs, treat as “changed”
3. Upsert `files`
4. Parse Markdown into `frontmatter` + `body`, normalize frontmatter fields + typed links, and upsert:
   - `notes`, `note_tags`, `note_keywords`, `note_sources`, `typed_links`
5. Chunk the Markdown body by headings (with `maxChars`) and compute stable chunk IDs per file
6. Compare existing chunks for that file to the next chunk set:
   - Delete chunks that no longer exist (including vec0 rows)
   - Update metadata for chunks that still exist (heading path, content, sha, timestamps)
7. Generate embeddings via the OpenAI embeddings API only for chunks that need them
   - Unchanged chunks reuse existing embeddings
8. Insert new `chunks`, `chunk_embeddings`, and `chunk_rowids` for newly introduced chunks

## Search flow

- Semantic retrieval embeds the query and performs a KNN search via sqlite-vec using `MATCH` + `k = ?`
- Due to sqlite-vec constraints, the KNN query needs `k = ?` or `LIMIT`, so matches are separated with a CTE
- Metadata filtering queries `notes` + mapping tables for frontmatter-derived filtering (id/entity/layer/status/tags/keywords/source/created/updated)
- Typed-link backrefs query `typed_links` (relation + target)

## Embedding dimension caveat

- Embedding model outputs vary by model (and can differ even when dimensions match).
- `chunk_embeddings` fixes the dimension at DB creation time, so changing the embedding model requires recreating the DB.
- AILSS records and validates `embedding_model` + `embedding_dim` in `db_meta`; on mismatch it fails fast with an explicit “reindex required” error.
