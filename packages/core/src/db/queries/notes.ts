import type { AilssDb } from "../db.js";
import { nowIso } from "../migrate.js";

import { normalizeStringList, safeParseJsonObject, toLiteralPrefixLikePattern } from "./shared.js";

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

export function searchNotes(db: AilssDb, filters: SearchNotesFilters = {}): SearchNotesResult[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.pathPrefix) {
    where.push(`notes.path LIKE ? ESCAPE '\\'`);
    params.push(toLiteralPrefixLikePattern(filters.pathPrefix));
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
