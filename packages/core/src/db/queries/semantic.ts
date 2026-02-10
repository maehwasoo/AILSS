import type { AilssDb } from "../db.js";

import {
  normalizeFilterStrings,
  safeParseJsonArray,
  toLiteralPrefixLikePattern,
} from "./shared.js";

export type SemanticSearchResult = {
  chunkId: string;
  path: string;
  chunkIndex: number;
  heading: string | null;
  headingPath: string[];
  content: string;
  distance: number;
};

export type SemanticSearchFilters = {
  pathPrefix?: string;
  tagsAny?: string[];
  tagsAll?: string[];
};

export function semanticSearch(
  db: AilssDb,
  queryEmbedding: number[],
  topK: number,
  filters: SemanticSearchFilters = {},
): SemanticSearchResult[] {
  const pathPrefix = filters.pathPrefix?.trim();
  const tagsAny = normalizeFilterStrings(filters.tagsAny);
  const tagsAll = normalizeFilterStrings(filters.tagsAll);

  const candidateWhere: string[] = [];
  const candidateParams: unknown[] = [];

  if (pathPrefix) {
    candidateWhere.push(`c.path LIKE ? ESCAPE '\\'`);
    candidateParams.push(toLiteralPrefixLikePattern(pathPrefix));
  }

  if (tagsAny.length > 0) {
    candidateWhere.push(
      `EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag IN (${tagsAny
        .map(() => "?")
        .join(", ")}))`,
    );
    candidateParams.push(...tagsAny);
  }

  for (const tag of tagsAll) {
    candidateWhere.push(`EXISTS (SELECT 1 FROM note_tags t WHERE t.path = c.path AND t.tag = ?)`);
    candidateParams.push(tag);
  }

  const hasCandidateScope = candidateWhere.length > 0;
  const candidatesCte = hasCandidateScope
    ? `
    candidates AS (
      SELECT r.rowid AS rowid
      FROM chunks c
      JOIN chunk_rowids r ON r.chunk_id = c.chunk_id
      WHERE ${candidateWhere.join(" AND ")}
    ),`
    : "";

  // vec0 search query
  // - sqlite-vec requires LIMIT or `k = ?` for KNN queries
  // - When JOINs are involved, LIMIT detection can break, so split via a CTE
  const stmt = db.prepare(`
    WITH ${candidatesCte}
    matches AS (
      SELECT rowid, distance
      FROM chunk_embeddings
      WHERE embedding MATCH ?
        AND k = ?
        ${hasCandidateScope ? "AND rowid IN (SELECT rowid FROM candidates)" : ""}
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

  const searchParams = hasCandidateScope
    ? [...candidateParams, JSON.stringify(queryEmbedding), topK]
    : [JSON.stringify(queryEmbedding), topK];
  const rows = stmt.all(...searchParams) as Array<{
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
