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

### `notes` table

Stores note-level metadata derived from frontmatter, plus the normalized raw frontmatter as JSON.

- `path` (PK, FK → `files.path`): vault-relative path
- `note_id`, `created`, `title`, `summary`
- `entity`, `layer`, `status`, `updated`, `viewed`
- `frontmatter_json`: normalized JSON (stable arrays for tags/keywords/typed links)

### `note_tags` / `note_keywords`

Simple mapping tables for fast filtering without relying on sqlite JSON functions.

- `note_tags(path, tag)`
- `note_keywords(path, keyword)`

### `typed_links`

Stores “typed links” as graph edges (frontmatter relations and body wikilinks).

- `from_path`: vault-relative source note path
- `rel`: relation key (e.g. `part_of`, `depends_on`, `links_to`)
- `to_target`: normalized wikilink target string (display text / headings removed)
- `to_wikilink`: canonical wikilink string like `[[WorldAce]]`
- `position`: ordering within the relation list

## Query support (current)

- `search_notes` supports only a fixed set of filters backed by indexed columns/tables:
  - `notes.entity`, `notes.layer`, `notes.status`
  - `note_tags.tag`, `note_keywords.keyword`
  - basic path/title filters
- `find_notes_by_typed_link` supports typed-link “backrefs” by `rel` + `to_target`.
- `get_note_meta` returns the full normalized frontmatter JSON, but arbitrary filtering over `frontmatter_json` is not implemented yet.

## Indexing flow

1. Scan for `.md` files in the vault (default ignores: `.obsidian`, `.git`, `.trash`, `.ailss`, etc.)
2. Compare the file sha256 to the DB; if it differs, treat as “changed”
3. Upsert `files`
4. Parse Markdown into `frontmatter` + `body`, normalize frontmatter fields + typed links, extract body `[[wikilinks]]` as `links_to`, and upsert:
   - `notes`, `note_tags`, `note_keywords`, `typed_links`
5. Clear prior `chunks` / `chunk_rowids` / `chunk_embeddings` rows for that file
6. Chunk the Markdown body by headings (with `maxChars`)
7. Generate embeddings via the OpenAI embeddings API (batched calls)
8. Insert `chunks`, `chunk_embeddings`, and `chunk_rowids`

## Search flow

- `semantic_search` embeds the query and performs a KNN search via sqlite-vec using `MATCH` + `k = ?`
- Due to sqlite-vec constraints, the KNN query needs `k = ?` or `LIMIT`, so matches are separated with a CTE
- `search_notes` queries `notes` + mapping tables for frontmatter-derived filtering (entity/layer/status/tags/keywords)
- `find_notes_by_typed_link` queries `typed_links` for typed-link “backrefs” (relation + target)

## Embedding dimension caveat

- Embedding dimensions vary by model
- `chunk_embeddings` fixes the dimension at DB creation time, so changing the model may require recreating the DB
