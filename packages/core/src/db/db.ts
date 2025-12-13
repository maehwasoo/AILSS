// AILSS SQLite DB
// - 파일(file), 청크(chunk), 벡터(embedding) 인덱스를 한 곳에 저장

import path from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

import { ensureDir } from "../vault/filesystem.js";

export type OpenAilssDbOptions = {
  dbPath: string;
  embeddingDim: number;
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
  const db = new Database(options.dbPath);

  // sqlite-vec extension 로드
  // - 고수준 벡터 검색을 위해 vec0 가상 테이블 사용
  loadSqliteVec(db);

  // 안정성 옵션
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db, options.embeddingDim);
  return db;
}

function migrate(db: AilssDb, embeddingDim: number): void {
  // 스키마: files, chunks, chunk_embeddings(vec0)
  // - vec0는 rowid 기반이 자연스럽지만, 우리는 chunk_id를 rowid로 매핑해요

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

  // sqlite-vec vec0 테이블
  // - rowid를 chunks.chunk_id와 1:1로 맞추기 위해 별도 mapping 테이블을 둬요
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_rowids (
      chunk_id TEXT PRIMARY KEY,
      rowid INTEGER UNIQUE NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
      embedding FLOAT[${embeddingDim}]
    );
  `);

  // 인덱싱 편의 뷰(view)
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

export function deleteChunksByPath(db: AilssDb, filePath: string): void {
  // ON DELETE CASCADE로 rowids 정리, vec0는 별도 삭제 필요
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

    // vec0 insert → rowid 확보
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
  // vec0 검색 쿼리
  // - sqlite-vec는 KNN 쿼리에서 LIMIT 또는 `k = ?` 제약이 필요해요
  // - JOIN이 섞이면 LIMIT 감지가 깨질 수 있어 CTE로 분리해요
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
