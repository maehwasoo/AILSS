import type { AilssDb, OpenAilssDbOptions } from "./db.js";

export function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

export function migrate(db: AilssDb, options: OpenAilssDbOptions): void {
  // Schema: files, chunks, chunk_embeddings(vec0), note metadata, typed links
  // - vec0 is rowid-based, so we map chunk_id to rowid

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      heading TEXT,
      heading_path_json TEXT NOT NULL,
      content TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
    );
  `);

  // DB metadata
  // - helps prevent mixing embeddings from different models/dimensions
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const hasAnyChunks = !!db.prepare(`SELECT 1 FROM chunks LIMIT 1`).get();

  const getMeta = (key: string): string | null => {
    const row = db.prepare(`SELECT value FROM db_meta WHERE key = ?`).get(key) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  };

  const setMeta = (key: string, value: string): void => {
    db.prepare(
      `
      INSERT INTO db_meta(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `,
    ).run(key, value, nowIso());
  };

  const existingModel = getMeta("embedding_model");
  const existingDimRaw = getMeta("embedding_dim");
  const existingDim = existingDimRaw ? Number(existingDimRaw) : null;

  const missingMeta = !existingModel || !existingDimRaw || !Number.isFinite(existingDim);
  if (missingMeta) {
    if (hasAnyChunks) {
      throw new Error(
        [
          "Index DB does not record the embedding model/dimension (likely created by an older AILSS version).",
          "Refusing to continue to avoid mixing incompatible embeddings in one DB.",
          `DB path: ${options.dbPath}`,
          "Fix: delete the DB and reindex (or choose a new --db path).",
        ].join(" "),
      );
    }

    setMeta("embedding_model", options.embeddingModel);
    setMeta("embedding_dim", String(options.embeddingDim));
  } else {
    if (existingModel !== options.embeddingModel || existingDim !== options.embeddingDim) {
      throw new Error(
        [
          "Embedding config mismatch for the index DB.",
          `DB path: ${options.dbPath}`,
          `DB expects: model=${existingModel}, dim=${existingDimRaw}`,
          `Current run: model=${options.embeddingModel}, dim=${options.embeddingDim}`,
          "Fix: delete the DB and reindex (or choose a new --db path).",
        ].join(" "),
      );
    }
  }

  // sqlite-vec vec0 table
  // - keep a separate mapping table to align rowid 1:1 with chunks.chunk_id
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_rowids (
      chunk_id TEXT PRIMARY KEY,
      rowid INTEGER UNIQUE NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      embedding FLOAT[${options.embeddingDim}]
    );
  `);

  // Indexing convenience view
  db.exec(`
    CREATE VIEW IF NOT EXISTS chunks_with_rowid AS
    SELECT
      c.chunk_id,
      r.rowid AS embedding_rowid,
      c.path,
      c.heading,
      c.heading_path_json,
      c.content,
      c.content_sha256,
      c.updated_at
    FROM chunks c
    JOIN chunk_rowids r ON r.chunk_id = c.chunk_id;
  `);

  // Notes table
  // - stores normalized frontmatter fields + raw JSON for future flexibility
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      note_id TEXT,
      created TEXT,
      title TEXT,
      summary TEXT,
      entity TEXT,
      layer TEXT,
      status TEXT,
      updated TEXT,
      viewed INTEGER,
      frontmatter_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_layer ON notes(layer);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_note_id ON notes(note_id);`);

  // Tag/keyword mappings
  // - avoids relying on sqlite json1 in all environments
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_tags (
      path TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY(path, tag),
      FOREIGN KEY(path) REFERENCES notes(path) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS note_keywords (
      path TEXT NOT NULL,
      keyword TEXT NOT NULL,
      PRIMARY KEY(path, keyword),
      FOREIGN KEY(path) REFERENCES notes(path) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_note_keywords_keyword ON note_keywords(keyword);`);

  // Typed links (frontmatter relations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS typed_links (
      from_path TEXT NOT NULL,
      rel TEXT NOT NULL,
      to_target TEXT NOT NULL,
      to_wikilink TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(from_path, rel, to_target, position),
      FOREIGN KEY(from_path) REFERENCES notes(path) ON DELETE CASCADE
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_typed_links_from_rel ON typed_links(from_path, rel);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_typed_links_rel_to ON typed_links(rel, to_target);`);
}
