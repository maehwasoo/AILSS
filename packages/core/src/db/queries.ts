import path from "node:path";

import type { AilssDb } from "./db.js";
import { nowIso } from "./migrate.js";

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

export function listChunkIdsByPath(db: AilssDb, filePath: string): string[] {
  const rows = db.prepare(`SELECT chunk_id AS chunkId FROM chunks WHERE path = ?`).all(filePath) as
    | Array<{ chunkId: string }>
    | undefined;
  return (rows ?? []).map((r) => r.chunkId).filter(Boolean);
}

export type ChunkEmbeddingCacheItem = {
  contentSha256: string;
  embedding: number[];
};

function safeParseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return value as number[];
  }
  if (typeof value === "string" || value instanceof Uint8Array) {
    try {
      const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "number")) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function listChunkEmbeddingsByPath(
  db: AilssDb,
  filePath: string,
): ChunkEmbeddingCacheItem[] {
  const rows = db
    .prepare(
      `
        SELECT
          c.content_sha256 AS contentSha256,
          e.embedding AS embedding
        FROM chunks c
        JOIN chunk_rowids r ON r.chunk_id = c.chunk_id
        JOIN chunk_embeddings e ON e.rowid = r.rowid
        WHERE c.path = ?
      `,
    )
    .all(filePath) as Array<{ contentSha256: string; embedding: unknown }>;

  // Stable dedupe by contentSha256 (keep first valid embedding)
  const out: ChunkEmbeddingCacheItem[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.contentSha256 ?? "";
    if (!key || seen.has(key)) continue;
    const parsed = safeParseEmbedding(row.embedding);
    if (!parsed) continue;
    seen.add(key);
    out.push({ contentSha256: key, embedding: parsed });
  }

  return out;
}

export function deleteChunksByIds(db: AilssDb, chunkIds: string[]): void {
  const ids = chunkIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return;

  const deleteRowidStmt = db.prepare(`DELETE FROM chunk_embeddings WHERE rowid = ?`);

  const tx = db.transaction(() => {
    // Avoid SQLite parameter limits by batching.
    const batchSize = 200;

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(",");

      const rowids = db
        .prepare(`SELECT rowid FROM chunk_rowids WHERE chunk_id IN (${placeholders})`)
        .all(...batch) as Array<{ rowid: number }>;

      for (const r of rowids) {
        deleteRowidStmt.run(r.rowid);
      }

      // ON DELETE CASCADE cleans chunk_rowids
      db.prepare(`DELETE FROM chunks WHERE chunk_id IN (${placeholders})`).run(...batch);
    }
  });

  tx();
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
  frontmatterJson: string;
};

export function upsertNote(db: AilssDb, input: UpsertNoteInput): void {
  const stmt = db.prepare(`
    INSERT INTO notes(
      path, note_id, created, title, summary,
      entity, layer, status, updated,
      frontmatter_json, updated_at
    )
    VALUES (
      @path, @note_id, @created, @title, @summary,
      @entity, @layer, @status, @updated,
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

export function replaceNoteSources(db: AilssDb, notePath: string, sources: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_sources WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_sources(path, source) VALUES (?, ?)`);
    for (const source of sources) {
      insert.run(notePath, source);
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
  tags: string[];
  keywords: string[];
  sources: string[];
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

  const sources = db
    .prepare(`SELECT source FROM note_sources WHERE path = ? ORDER BY source`)
    .all(notePath) as Array<{ source: string }>;

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
    tags: tags.map((t) => t.tag),
    keywords: keywords.map((k) => k.keyword),
    sources: sources.map((s) => s.source),
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
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  tagsAny?: string[];
  tagsAll?: string[];
  keywordsAny?: string[];
  sourcesAny?: string[];
  orderBy?: "path" | "created" | "updated";
  orderDir?: "asc" | "desc";
  limit?: number;
};

export type SearchNotesResult = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  keywords: string[];
  sources: string[];
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

  if (filters.createdFrom) {
    where.push(`notes.created IS NOT NULL AND notes.created >= ?`);
    params.push(filters.createdFrom);
  }

  if (filters.createdTo) {
    where.push(`notes.created IS NOT NULL AND notes.created <= ?`);
    params.push(filters.createdTo);
  }

  if (filters.updatedFrom) {
    where.push(`notes.updated IS NOT NULL AND notes.updated >= ?`);
    params.push(filters.updatedFrom);
  }

  if (filters.updatedTo) {
    where.push(`notes.updated IS NOT NULL AND notes.updated <= ?`);
    params.push(filters.updatedTo);
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

  const sourcesAny = filters.sourcesAny?.filter(Boolean) ?? [];
  if (sourcesAny.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM note_sources s WHERE s.path = notes.path AND s.source IN (${sourcesAny
        .map(() => "?")
        .join(", ")}))`,
    );
    params.push(...sourcesAny);
  }

  const limit = Math.min(Math.max(1, filters.limit ?? 50), 500);

  const orderBy = filters.orderBy ?? "path";
  const orderDir = filters.orderDir ?? "asc";
  const dirSql = orderDir === "desc" ? "DESC" : "ASC";

  const orderSql =
    orderBy === "created"
      ? `notes.created IS NULL, notes.created ${dirSql}, notes.path`
      : orderBy === "updated"
        ? `notes.updated IS NULL, notes.updated ${dirSql}, notes.path`
        : `notes.path ${dirSql}`;

  const sql = `
    SELECT path, note_id, created, title, summary, entity, layer, status, updated
    FROM notes
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderSql}
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params, limit) as Array<{
    path: string;
    note_id: string | null;
    created: string | null;
    title: string | null;
    summary: string | null;
    entity: string | null;
    layer: string | null;
    status: string | null;
    updated: string | null;
  }>;

  if (rows.length === 0) return [];

  const paths = rows.map((r) => r.path);
  const placeholders = paths.map(() => "?").join(", ");

  const tagsByPath = new Map<string, string[]>();
  const tagsRows = db
    .prepare(`SELECT path, tag FROM note_tags WHERE path IN (${placeholders}) ORDER BY tag`)
    .all(...paths) as Array<{ path: string; tag: string }>;
  for (const row of tagsRows) {
    const list = tagsByPath.get(row.path) ?? [];
    list.push(row.tag);
    tagsByPath.set(row.path, list);
  }

  const keywordsByPath = new Map<string, string[]>();
  const keywordRows = db
    .prepare(
      `SELECT path, keyword FROM note_keywords WHERE path IN (${placeholders}) ORDER BY keyword`,
    )
    .all(...paths) as Array<{ path: string; keyword: string }>;
  for (const row of keywordRows) {
    const list = keywordsByPath.get(row.path) ?? [];
    list.push(row.keyword);
    keywordsByPath.set(row.path, list);
  }

  const sourcesByPath = new Map<string, string[]>();
  const sourceRows = db
    .prepare(
      `SELECT path, source FROM note_sources WHERE path IN (${placeholders}) ORDER BY source`,
    )
    .all(...paths) as Array<{ path: string; source: string }>;
  for (const row of sourceRows) {
    const list = sourcesByPath.get(row.path) ?? [];
    list.push(row.source);
    sourcesByPath.set(row.path, list);
  }

  return rows.map((row) => ({
    path: row.path,
    noteId: row.note_id,
    created: row.created,
    title: row.title,
    summary: row.summary,
    entity: row.entity,
    layer: row.layer,
    status: row.status,
    updated: row.updated,
    tags: tagsByPath.get(row.path) ?? [],
    keywords: keywordsByPath.get(row.path) ?? [],
    sources: sourcesByPath.get(row.path) ?? [],
  }));
}

export type TagFacet = { tag: string; count: number };

export function listTags(db: AilssDb, options: { limit?: number } = {}): TagFacet[] {
  const limit = Math.min(Math.max(1, options.limit ?? 200), 5000);
  const rows = db
    .prepare(
      `
        SELECT tag, COUNT(*) as count
        FROM note_tags
        GROUP BY tag
        ORDER BY count DESC, tag ASC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{ tag: string; count: number }>;
  return rows;
}

export type KeywordFacet = { keyword: string; count: number };

export function listKeywords(db: AilssDb, options: { limit?: number } = {}): KeywordFacet[] {
  const limit = Math.min(Math.max(1, options.limit ?? 200), 5000);
  const rows = db
    .prepare(
      `
        SELECT keyword, COUNT(*) as count
        FROM note_keywords
        GROUP BY keyword
        ORDER BY count DESC, keyword ASC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{ keyword: string; count: number }>;
  return rows;
}

export type SqliteGraphCounts = {
  notes: number;
  typedLinks: number;
};

export function getSqliteGraphCounts(db: AilssDb): SqliteGraphCounts {
  const noteRow = db.prepare(`SELECT COUNT(*) AS count FROM notes`).get() as { count: number };
  const typedLinkRow = db.prepare(`SELECT COUNT(*) AS count FROM typed_links`).get() as {
    count: number;
  };
  return {
    notes: noteRow.count ?? 0,
    typedLinks: typedLinkRow.count ?? 0,
  };
}

export type GraphSyncNoteRow = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
};

export function listNotesForGraphSync(db: AilssDb): GraphSyncNoteRow[] {
  const rows = db
    .prepare(
      `
        SELECT
          path,
          note_id AS noteId,
          created,
          title,
          summary,
          entity,
          layer,
          status,
          updated
        FROM notes
        ORDER BY path
      `,
    )
    .all() as GraphSyncNoteRow[];
  return rows;
}

export type GraphSyncTypedLinkRow = {
  fromPath: string;
  rel: string;
  toTarget: string;
  toWikilink: string;
  position: number;
};

export function listTypedLinksForGraphSync(db: AilssDb): GraphSyncTypedLinkRow[] {
  const rows = db
    .prepare(
      `
        SELECT
          from_path AS fromPath,
          rel,
          to_target AS toTarget,
          to_wikilink AS toWikilink,
          position
        FROM typed_links
        ORDER BY from_path, position, rel, to_target
      `,
    )
    .all() as GraphSyncTypedLinkRow[];
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
  matchedBy: "path" | "note_id" | "title";
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

  // Note ID match (frontmatter-derived, if present)
  const noteIdMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE note_id = ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetNoExt, effectiveLimit) as Array<{ path: string; title: string | null }>;

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

  for (const row of noteIdMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "note_id" });
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
  chunkIndex: number;
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
      INSERT INTO chunks(chunk_id, path, chunk_index, heading, heading_path_json, content, content_sha256, updated_at)
      VALUES (@chunk_id, @path, @chunk_index, @heading, @heading_path_json, @content, @content_sha256, @updated_at)
    `,
    ).run({
      chunk_id: input.chunkId,
      path: input.path,
      chunk_index: Math.floor(input.chunkIndex),
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

export type UpdateChunkMetadataInput = {
  chunkId: string;
  path: string;
  chunkIndex: number;
  heading: string | null;
  headingPathJson: string;
  content: string;
  contentSha256: string;
};

export function updateChunkMetadata(db: AilssDb, input: UpdateChunkMetadataInput): void {
  db.prepare(
    `
      UPDATE chunks
      SET
        path = @path,
        chunk_index = @chunk_index,
        heading = @heading,
        heading_path_json = @heading_path_json,
        content = @content,
        content_sha256 = @content_sha256,
        updated_at = @updated_at
      WHERE chunk_id = @chunk_id
    `,
  ).run({
    chunk_id: input.chunkId,
    path: input.path,
    chunk_index: Math.floor(input.chunkIndex),
    heading: input.heading,
    heading_path_json: input.headingPathJson,
    content: input.content,
    content_sha256: input.contentSha256,
    updated_at: nowIso(),
  });
}

export type SemanticSearchResult = {
  chunkId: string;
  path: string;
  chunkIndex: number;
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
      c.chunk_index AS chunkIndex,
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
    chunkIndex: number;
    heading: string | null;
    headingPathJson: string;
    content: string;
    distance: number;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    path: row.path,
    chunkIndex: row.chunkIndex,
    heading: row.heading,
    headingPath: safeParseJsonArray(row.headingPathJson),
    content: row.content,
    distance: row.distance,
  }));
}

export type ChunkContentByIndex = {
  chunkId: string;
  chunkIndex: number;
  heading: string | null;
  headingPath: string[];
  content: string;
};

export function listChunksByPathAndIndices(
  db: AilssDb,
  filePath: string,
  indices: number[],
): ChunkContentByIndex[] {
  const wanted = indices.map((n) => Math.floor(n)).filter((n) => Number.isFinite(n) && n >= 0);

  const deduped: number[] = [];
  const seen = new Set<number>();
  for (const n of wanted) {
    if (seen.has(n)) continue;
    seen.add(n);
    deduped.push(n);
  }

  if (deduped.length === 0) return [];

  const placeholders = deduped.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT
          chunk_id AS chunkId,
          chunk_index AS chunkIndex,
          heading AS heading,
          heading_path_json AS headingPathJson,
          content AS content
        FROM chunks
        WHERE path = ?
          AND chunk_index IN (${placeholders})
        ORDER BY chunk_index ASC
      `,
    )
    .all(filePath, ...deduped) as Array<{
    chunkId: string;
    chunkIndex: number;
    heading: string | null;
    headingPathJson: string;
    content: string;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    chunkIndex: row.chunkIndex,
    heading: row.heading,
    headingPath: safeParseJsonArray(row.headingPathJson),
    content: row.content,
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
