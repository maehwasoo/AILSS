import type { AilssDb } from "../../db.js";

import { normalizeStringList, toLiteralPrefixLikePattern } from "../shared.js";

import type { SearchNotesFilters, SearchNotesResult } from "./types.js";

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
