// SQLite DB + sqlite-vec 검색 테스트

import { afterEach, describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  deleteChunksByPath,
  insertChunkWithEmbedding,
  openAilssDb,
  semanticSearch,
  upsertFile,
} from "../src/db/db.js";

let tempDir: string | null = null;

async function mkTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-"));
  tempDir = dir;
  return dir;
}

afterEach(async () => {
  if (!tempDir) return;
  await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("openAilssDb() + semanticSearch()", () => {
  it("청크 삽입 후 벡터 검색 결과를 반환해요", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingDim: 3 });

    try {
      upsertFile(db, {
        path: "notes/a.md",
        mtimeMs: 0,
        sizeBytes: 0,
        sha256: "file-sha",
      });

      insertChunkWithEmbedding(db, {
        chunkId: "chunk-1",
        path: "notes/a.md",
        heading: "A",
        headingPathJson: JSON.stringify(["A"]),
        content: "hello world",
        contentSha256: "content-sha",
        embedding: [0.1, 0.2, 0.3],
      });

      const results = semanticSearch(db, [0.1, 0.2, 0.3], 1);
      expect(results).toHaveLength(1);
      expect(results[0]?.chunkId).toBe("chunk-1");
      expect(results[0]?.path).toBe("notes/a.md");
      expect(results[0]?.headingPath).toEqual(["A"]);
    } finally {
      db.close();
    }
  });

  it("deleteChunksByPath()는 vec0 row도 같이 정리해요", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingDim: 3 });

    try {
      upsertFile(db, {
        path: "notes/a.md",
        mtimeMs: 0,
        sizeBytes: 0,
        sha256: "file-sha",
      });

      insertChunkWithEmbedding(db, {
        chunkId: "chunk-1",
        path: "notes/a.md",
        heading: "A",
        headingPathJson: JSON.stringify(["A"]),
        content: "hello world",
        contentSha256: "content-sha",
        embedding: [0.1, 0.2, 0.3],
      });

      deleteChunksByPath(db, "notes/a.md");

      const results = semanticSearch(db, [0.1, 0.2, 0.3], 10);
      expect(results).toEqual([]);
    } finally {
      db.close();
    }
  });
});
