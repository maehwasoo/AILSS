import type { AilssDb } from "../db.js";
import { nowIso } from "../migrate.js";

import { safeParseEmbedding, safeParseJsonArray } from "./shared.js";

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
