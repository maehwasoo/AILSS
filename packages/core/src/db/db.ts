// AILSS SQLite DB
// - store file, chunk, and embedding indices in one place

import path from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

import { ensureDir } from "../vault/filesystem.js";

export type OpenAilssDbOptions = {
  dbPath: string;
  embeddingModel: string;
  embeddingDim: number;
  mode?: "readwrite" | "readonly";
};

export type AilssDb = Database.Database;

function nowIso(): string {
  return new Date().toISOString().slice(0, 19);
}

export async function resolveDefaultDbPath(vaultPath: string): Promise<string> {
  const dir = path.join(vaultPath, ".ailss");
  await ensureDir(dir);
  return path.join(dir, "index.sqlite");
}

export function openAilssDb(options: OpenAilssDbOptions): AilssDb {
  const mode = options.mode ?? "readwrite";
  const db =
    mode === "readonly"
      ? new Database(options.dbPath, { readonly: true, fileMustExist: true })
      : new Database(options.dbPath);

  try {
    // Load sqlite-vec extension
    // - use vec0 virtual table for vector search
    loadSqliteVec(db);

    // Stability pragmas
    db.pragma("foreign_keys = ON");
    if (mode === "readonly") {
      db.pragma("query_only = ON");
      validateExistingDb(db, options);
      return db;
    }

    db.pragma("journal_mode = WAL");

    migrate(db, options);
    return db;
  } catch (error) {
    // Avoid leaving the DB locked if migration/validation fails
    try {
      db.close();
    } catch {
      // ignore
    }
    throw error;
  }
}

function validateExistingDb(db: AilssDb, options: OpenAilssDbOptions): void {
  const hasTable = (name: string): boolean => {
    const row = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
      .get(name) as { 1?: 1 } | undefined;
    return !!row;
  };

  if (!hasTable("chunks") || !hasTable("db_meta")) {
    throw new Error(
      [
        "Index DB schema is missing or incomplete.",
        `DB path: ${options.dbPath}`,
        "Fix: run ailss-indexer to create the DB (or set AILSS_DB_PATH to an existing index.sqlite).",
      ].join(" "),
    );
  }

  const getMeta = (key: string): string | null => {
    const row = db.prepare(`SELECT value FROM db_meta WHERE key = ?`).get(key) as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  };

  const existingModel = getMeta("embedding_model");
  const existingDimRaw = getMeta("embedding_dim");
  const existingDim = existingDimRaw ? Number(existingDimRaw) : null;

  const missingMeta = !existingModel || !existingDimRaw || !Number.isFinite(existingDim);
  if (missingMeta) {
    throw new Error(
      [
        "Index DB does not record the embedding model/dimension (likely uninitialized or created by an older AILSS version).",
        "Refusing to continue to avoid mixing incompatible embeddings in one DB.",
        `DB path: ${options.dbPath}`,
        "Fix: delete the DB and reindex (or choose a different DB path).",
      ].join(" "),
    );
  }

  if (existingModel !== options.embeddingModel || existingDim !== options.embeddingDim) {
    throw new Error(
      [
        "Embedding config mismatch for the index DB.",
        `DB path: ${options.dbPath}`,
        `DB expects: model=${existingModel}, dim=${existingDimRaw}`,
        `Current run: model=${options.embeddingModel}, dim=${options.embeddingDim}`,
        "Fix: delete the DB and reindex (or choose a new DB path).",
      ].join(" "),
    );
  }
}

function migrate(db: AilssDb, options: OpenAilssDbOptions): void {
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

export type UpsertFileInput = {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  sha256: string;
};

export function upsertFile(db: AilssDb, input: UpsertFileInput): void {
  const stmt = db.prepare(`
    INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at)
    VALUES (@path, @mtime_ms, @size_bytes, @sha256, @updated_at)
    ON CONFLICT(path) DO UPDATE SET
      mtime_ms=excluded.mtime_ms,
      size_bytes=excluded.size_bytes,
      sha256=excluded.sha256,
      updated_at=excluded.updated_at
  `);

  stmt.run({
    path: input.path,
    mtime_ms: Math.floor(input.mtimeMs),
    size_bytes: input.sizeBytes,
    sha256: input.sha256,
    updated_at: nowIso(),
  });
}

export function getFileSha256(db: AilssDb, filePath: string): string | null {
  const row = db.prepare(`SELECT sha256 FROM files WHERE path = ?`).get(filePath) as
    | { sha256?: string }
    | undefined;
  return row?.sha256 ?? null;
}

export function listFilePaths(db: AilssDb): string[] {
  const rows = db.prepare(`SELECT path FROM files ORDER BY path ASC`).all() as Array<{
    path: string;
  }>;
  return rows.map((r) => r.path);
}

export function deleteChunksByPath(db: AilssDb, filePath: string): void {
  // ON DELETE CASCADE cleans chunk_rowids; vec0 requires manual deletion
  const rowids = db
    .prepare(
      `SELECT rowid FROM chunk_rowids WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE path = ?)`,
    )
    .all(filePath) as Array<{ rowid: number }>;

  const deleteRowidStmt = db.prepare(`DELETE FROM chunk_embeddings WHERE rowid = ?`);
  for (const r of rowids) {
    deleteRowidStmt.run(r.rowid);
  }

  db.prepare(`DELETE FROM chunks WHERE path = ?`).run(filePath);
}

export function deleteFileByPath(db: AilssDb, filePath: string): void {
  // Vec0 manual cleanup before foreign-key cascades
  deleteChunksByPath(db, filePath);
  db.prepare(`DELETE FROM files WHERE path = ?`).run(filePath);
}

export type UpsertNoteInput = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  viewed: number | null;
  frontmatterJson: string;
};

export function upsertNote(db: AilssDb, input: UpsertNoteInput): void {
  const stmt = db.prepare(`
    INSERT INTO notes(
      path, note_id, created, title, summary,
      entity, layer, status, updated, viewed,
      frontmatter_json, updated_at
    )
    VALUES (
      @path, @note_id, @created, @title, @summary,
      @entity, @layer, @status, @updated, @viewed,
      @frontmatter_json, @updated_at
    )
    ON CONFLICT(path) DO UPDATE SET
      note_id=excluded.note_id,
      created=excluded.created,
      title=excluded.title,
      summary=excluded.summary,
      entity=excluded.entity,
      layer=excluded.layer,
      status=excluded.status,
      updated=excluded.updated,
      viewed=excluded.viewed,
      frontmatter_json=excluded.frontmatter_json,
      updated_at=excluded.updated_at
  `);

  stmt.run({
    path: input.path,
    note_id: input.noteId,
    created: input.created,
    title: input.title,
    summary: input.summary,
    entity: input.entity,
    layer: input.layer,
    status: input.status,
    updated: input.updated,
    viewed: input.viewed,
    frontmatter_json: input.frontmatterJson,
    updated_at: nowIso(),
  });
}

export function replaceNoteTags(db: AilssDb, notePath: string, tags: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_tags WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_tags(path, tag) VALUES (?, ?)`);
    for (const tag of tags) {
      insert.run(notePath, tag);
    }
  });
  tx();
}

export function replaceNoteKeywords(db: AilssDb, notePath: string, keywords: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_keywords WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_keywords(path, keyword) VALUES (?, ?)`);
    for (const keyword of keywords) {
      insert.run(notePath, keyword);
    }
  });
  tx();
}

export type TypedLinkInput = {
  rel: string;
  toTarget: string;
  toWikilink: string;
  position: number;
};

export function replaceTypedLinks(db: AilssDb, fromPath: string, links: TypedLinkInput[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM typed_links WHERE from_path = ?`).run(fromPath);
    const insert = db.prepare(`
      INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at)
      VALUES (@from_path, @rel, @to_target, @to_wikilink, @position, @created_at)
    `);

    for (const link of links) {
      insert.run({
        from_path: fromPath,
        rel: link.rel,
        to_target: link.toTarget,
        to_wikilink: link.toWikilink,
        position: link.position,
        created_at: nowIso(),
      });
    }
  });

  tx();
}

export type NoteRow = {
  path: string;
  note_id: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  viewed: number | null;
  frontmatter_json: string;
  updated_at: string;
};

export type NoteMeta = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  viewed: number | null;
  tags: string[];
  keywords: string[];
  frontmatter: Record<string, unknown>;
  typedLinks: Array<{
    rel: string;
    toTarget: string;
    toWikilink: string;
    position: number;
  }>;
};

function safeParseJsonObject(input: string): Record<string, unknown> {
  try {
    const value = JSON.parse(input);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function getNoteMeta(db: AilssDb, notePath: string): NoteMeta | null {
  const note = db.prepare(`SELECT * FROM notes WHERE path = ?`).get(notePath) as
    | NoteRow
    | undefined;
  if (!note) return null;

  const tags = db
    .prepare(`SELECT tag FROM note_tags WHERE path = ? ORDER BY tag`)
    .all(notePath) as Array<{ tag: string }>;

  const keywords = db
    .prepare(`SELECT keyword FROM note_keywords WHERE path = ? ORDER BY keyword`)
    .all(notePath) as Array<{ keyword: string }>;

  const typedLinks = db
    .prepare(
      `SELECT rel, to_target, to_wikilink, position FROM typed_links WHERE from_path = ? ORDER BY rel, position`,
    )
    .all(notePath) as Array<{
    rel: string;
    to_target: string;
    to_wikilink: string;
    position: number;
  }>;

  return {
    path: note.path,
    noteId: note.note_id,
    created: note.created,
    title: note.title,
    summary: note.summary,
    entity: note.entity,
    layer: note.layer,
    status: note.status,
    updated: note.updated,
    viewed: note.viewed,
    tags: tags.map((t) => t.tag),
    keywords: keywords.map((k) => k.keyword),
    frontmatter: safeParseJsonObject(note.frontmatter_json),
    typedLinks: typedLinks.map((l) => ({
      rel: l.rel,
      toTarget: l.to_target,
      toWikilink: l.to_wikilink,
      position: l.position,
    })),
  };
}

export type SearchNotesFilters = {
  pathPrefix?: string;
  titleQuery?: string;
  noteId?: string | string[];
  entity?: string | string[];
  layer?: string | string[];
  status?: string | string[];
  tagsAny?: string[];
  tagsAll?: string[];
  keywordsAny?: string[];
  limit?: number;
};

export type SearchNotesResult = {
  path: string;
  title: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
};

function normalizeStringList(input: string | string[] | undefined): string[] | undefined {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input;
  return undefined;
}

export function searchNotes(db: AilssDb, filters: SearchNotesFilters = {}): SearchNotesResult[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.pathPrefix) {
    where.push(`notes.path LIKE ?`);
    params.push(`${filters.pathPrefix}%`);
  }

  if (filters.titleQuery) {
    where.push(`notes.title LIKE ?`);
    params.push(`%${filters.titleQuery}%`);
  }

  const noteIdList = normalizeStringList(filters.noteId);
  if (noteIdList && noteIdList.length > 0) {
    where.push(`notes.note_id IN (${noteIdList.map(() => "?").join(", ")})`);
    params.push(...noteIdList);
  }

  const entityList = normalizeStringList(filters.entity);
  if (entityList && entityList.length > 0) {
    where.push(`notes.entity IN (${entityList.map(() => "?").join(", ")})`);
    params.push(...entityList);
  }

  const layerList = normalizeStringList(filters.layer);
  if (layerList && layerList.length > 0) {
    where.push(`notes.layer IN (${layerList.map(() => "?").join(", ")})`);
    params.push(...layerList);
  }

  const statusList = normalizeStringList(filters.status);
  if (statusList && statusList.length > 0) {
    where.push(`notes.status IN (${statusList.map(() => "?").join(", ")})`);
    params.push(...statusList);
  }

  const tagsAny = filters.tagsAny?.filter(Boolean) ?? [];
  if (tagsAny.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag IN (${tagsAny
        .map(() => "?")
        .join(", ")}))`,
    );
    params.push(...tagsAny);
  }

  const tagsAll = filters.tagsAll?.filter(Boolean) ?? [];
  for (const tag of tagsAll) {
    where.push(`EXISTS (SELECT 1 FROM note_tags t WHERE t.path = notes.path AND t.tag = ?)`);
    params.push(tag);
  }

  const keywordsAny = filters.keywordsAny?.filter(Boolean) ?? [];
  if (keywordsAny.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM note_keywords k WHERE k.path = notes.path AND k.keyword IN (${keywordsAny
        .map(() => "?")
        .join(", ")}))`,
    );
    params.push(...keywordsAny);
  }

  const limit = Math.min(Math.max(1, filters.limit ?? 50), 500);

  const sql = `
    SELECT path, title, entity, layer, status
    FROM notes
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY path
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params, limit) as Array<{
    path: string;
    title: string | null;
    entity: string | null;
    layer: string | null;
    status: string | null;
  }>;

  return rows;
}

export type TypedLinkQuery = {
  rel?: string;
  toTarget?: string;
  limit?: number;
};

export type TypedLinkBackref = {
  fromPath: string;
  fromTitle: string | null;
  rel: string;
  toTarget: string;
  toWikilink: string;
};

export function findNotesByTypedLink(db: AilssDb, query: TypedLinkQuery): TypedLinkBackref[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.rel) {
    where.push(`tl.rel = ?`);
    params.push(query.rel);
  }

  if (query.toTarget) {
    where.push(`tl.to_target = ?`);
    params.push(query.toTarget);
  }

  const limit = Math.min(Math.max(1, query.limit ?? 100), 1000);

  const sql = `
    SELECT
      tl.from_path AS fromPath,
      n.title AS fromTitle,
      tl.rel AS rel,
      tl.to_target AS toTarget,
      tl.to_wikilink AS toWikilink
    FROM typed_links tl
    JOIN notes n ON n.path = tl.from_path
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY tl.rel, tl.to_target, tl.from_path, tl.position
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit) as TypedLinkBackref[];
}

export type ResolvedNoteTarget = {
  path: string;
  title: string | null;
  matchedBy: "path" | "title";
};

export function resolveNotePathsByWikilinkTarget(
  db: AilssDb,
  target: string,
  limit = 20,
): ResolvedNoteTarget[] {
  const trimmed = target.trim();
  if (!trimmed) return [];

  const effectiveLimit = Math.min(Math.max(1, limit), 200);

  // Wikilink target normalization
  // - support users who include `.md` in wikilinks
  const targetNoExt = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
  const targetWithExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;

  // Path-based match (vault-relative paths)
  const pathMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE path = ? OR path LIKE ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetWithExt, `%/${targetWithExt}`, effectiveLimit) as Array<{
    path: string;
    title: string | null;
  }>;

  // Title-based match (frontmatter-derived, if present)
  const titleMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE title = ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetNoExt, effectiveLimit) as Array<{ path: string; title: string | null }>;

  // Stable dedupe
  const out: ResolvedNoteTarget[] = [];
  const seen = new Set<string>();

  for (const row of pathMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "path" });
    if (out.length >= effectiveLimit) return out;
  }

  for (const row of titleMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "title" });
    if (out.length >= effectiveLimit) return out;
  }

  return out;
}

export function guessWikilinkTargetsForNote(
  meta: Pick<NoteMeta, "path" | "title" | "noteId" | "frontmatter">,
): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined): void => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    targets.push(trimmed);
  };

  // Filename stem (default wikilink target in Obsidian)
  const base = path.basename(meta.path);
  const stem = base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
  add(stem);

  // Structured fields
  add(meta.title);
  add(meta.noteId);

  // Aliases (if present)
  const aliasesRaw = meta.frontmatter.aliases;
  if (typeof aliasesRaw === "string") {
    add(aliasesRaw);
  } else if (Array.isArray(aliasesRaw)) {
    for (const v of aliasesRaw) {
      if (typeof v === "string") add(v);
    }
  }

  return targets;
}

export type InsertChunkInput = {
  chunkId: string;
  path: string;
  heading: string | null;
  headingPathJson: string;
  content: string;
  contentSha256: string;
  embedding: number[];
};

export function insertChunkWithEmbedding(db: AilssDb, input: InsertChunkInput): void {
  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO chunks(chunk_id, path, heading, heading_path_json, content, content_sha256, updated_at)
      VALUES (@chunk_id, @path, @heading, @heading_path_json, @content, @content_sha256, @updated_at)
    `,
    ).run({
      chunk_id: input.chunkId,
      path: input.path,
      heading: input.heading,
      heading_path_json: input.headingPathJson,
      content: input.content,
      content_sha256: input.contentSha256,
      updated_at: nowIso(),
    });

    // Insert into vec0 → capture rowid
    const vecInsert = db.prepare(`INSERT INTO chunk_embeddings(embedding) VALUES (?)`);
    const info = vecInsert.run(JSON.stringify(input.embedding));
    const rowid = Number(info.lastInsertRowid);

    db.prepare(`INSERT INTO chunk_rowids(chunk_id, rowid) VALUES (?, ?)`).run(input.chunkId, rowid);
  });

  tx();
}

export type SemanticSearchResult = {
  chunkId: string;
  path: string;
  heading: string | null;
  headingPath: string[];
  content: string;
  distance: number;
};

export function semanticSearch(
  db: AilssDb,
  queryEmbedding: number[],
  topK: number,
): SemanticSearchResult[] {
  // vec0 search query
  // - sqlite-vec requires LIMIT or `k = ?` for KNN queries
  // - When JOINs are involved, LIMIT detection can break, so split via a CTE
  const stmt = db.prepare(`
    WITH matches AS (
      SELECT rowid, distance
      FROM chunk_embeddings
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
    )
    SELECT
      c.chunk_id AS chunkId,
      c.path AS path,
      c.heading AS heading,
      c.heading_path_json AS headingPathJson,
      c.content AS content,
      m.distance AS distance
    FROM matches m
    JOIN chunk_rowids r ON r.rowid = m.rowid
    JOIN chunks c ON c.chunk_id = r.chunk_id
    ORDER BY m.distance
  `);

  const rows = stmt.all(JSON.stringify(queryEmbedding), topK) as Array<{
    chunkId: string;
    path: string;
    heading: string | null;
    headingPathJson: string;
    content: string;
    distance: number;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    path: row.path,
    heading: row.heading,
    headingPath: safeParseJsonArray(row.headingPathJson),
    content: row.content,
    distance: row.distance,
  }));
}

function safeParseJsonArray(input: string): string[] {
  try {
    const value = JSON.parse(input);
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
    return [];
  } catch {
    return [];
  }
}
