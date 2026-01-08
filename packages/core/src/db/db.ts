// AILSS SQLite DB
// - store file, chunk, and embedding indices in one place

import path from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

import { ensureDir } from "../vault/filesystem.js";

import { migrate } from "./migrate.js";

export type OpenAilssDbOptions = {
  dbPath: string;
  embeddingModel: string;
  embeddingDim: number;
};

export type AilssDb = Database.Database;

export async function resolveDefaultDbPath(vaultPath: string): Promise<string> {
  const dir = path.join(vaultPath, ".ailss");
  await ensureDir(dir);
  return path.join(dir, "index.sqlite");
}

export function openAilssDb(options: OpenAilssDbOptions): AilssDb {
  const db = new Database(options.dbPath);

  try {
    // Load sqlite-vec extension
    // - use vec0 virtual table for vector search
    loadSqliteVec(db);

    // Stability pragmas
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

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

export * from "./queries.js";
