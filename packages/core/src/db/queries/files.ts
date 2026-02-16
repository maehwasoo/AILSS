import type { AilssDb } from "../db.js";
import { nowIso } from "../migrate.js";

import { deleteChunksByPath } from "./chunks.js";

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

export function deleteFileByPath(db: AilssDb, filePath: string): void {
  // Vec0 manual cleanup before foreign-key cascades
  deleteChunksByPath(db, filePath);
  db.prepare(`DELETE FROM files WHERE path = ?`).run(filePath);
}
