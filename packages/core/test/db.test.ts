// SQLite DB + sqlite-vec search tests

import { afterEach, describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  deleteChunksByPath,
  deleteFileByPath,
  insertChunkWithEmbedding,
  listFilePaths,
  openAilssDb,
  searchNotes,
  semanticSearch,
  upsertFile,
  upsertNote,
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
  it("returns vector search results after inserting a chunk", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

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

  it("deleteChunksByPath() also removes vec0 rows", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

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

  it("deleteFileByPath() removes file rows and cascades", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

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

      expect(listFilePaths(db)).toEqual(["notes/a.md"]);

      deleteFileByPath(db, "notes/a.md");

      expect(listFilePaths(db)).toEqual([]);
      expect(semanticSearch(db, [0.1, 0.2, 0.3], 10)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("searchNotes()", () => {
  it("filters by noteId (notes.note_id)", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

    try {
      upsertFile(db, {
        path: "notes/a.md",
        mtimeMs: 0,
        sizeBytes: 0,
        sha256: "file-a",
      });
      upsertFile(db, {
        path: "notes/b.md",
        mtimeMs: 0,
        sizeBytes: 0,
        sha256: "file-b",
      });

      upsertNote(db, {
        path: "notes/a.md",
        noteId: "note-a",
        created: null,
        title: "A",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        viewed: null,
        frontmatterJson: "{}",
      });
      upsertNote(db, {
        path: "notes/b.md",
        noteId: "note-b",
        created: null,
        title: "B",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        viewed: null,
        frontmatterJson: "{}",
      });

      expect(searchNotes(db, { noteId: "note-a" })).toEqual([
        { path: "notes/a.md", title: "A", entity: null, layer: null, status: null },
      ]);
      expect(searchNotes(db, { noteId: ["note-a", "note-b"] })).toEqual([
        { path: "notes/a.md", title: "A", entity: null, layer: null, status: null },
        { path: "notes/b.md", title: "B", entity: null, layer: null, status: null },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("openAilssDb() embedding config validation", () => {
  it("throws when embedding model changes", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const db = openAilssDb({ dbPath, embeddingModel: "model-a", embeddingDim: 3 });
    db.close();

    expect(() => openAilssDb({ dbPath, embeddingModel: "model-b", embeddingDim: 3 })).toThrow(
      /Embedding config mismatch/i,
    );
  });

  it("throws when embedding dimension changes", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const db = openAilssDb({ dbPath, embeddingModel: "model-a", embeddingDim: 3 });
    db.close();

    expect(() => openAilssDb({ dbPath, embeddingModel: "model-a", embeddingDim: 4 })).toThrow(
      /Embedding config mismatch/i,
    );
  });

  it("refuses to guess embedding config for a non-empty DB without meta", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const db = openAilssDb({ dbPath, embeddingModel: "model-a", embeddingDim: 3 });
    try {
      upsertFile(db, { path: "notes/a.md", mtimeMs: 0, sizeBytes: 0, sha256: "file-sha" });
      insertChunkWithEmbedding(db, {
        chunkId: "chunk-1",
        path: "notes/a.md",
        heading: "A",
        headingPathJson: JSON.stringify(["A"]),
        content: "hello world",
        contentSha256: "content-sha",
        embedding: [0.1, 0.2, 0.3],
      });

      db.prepare(`DELETE FROM db_meta`).run();
    } finally {
      db.close();
    }

    expect(() => openAilssDb({ dbPath, embeddingModel: "model-a", embeddingDim: 3 })).toThrow(
      /does not record the embedding model\/dimension/i,
    );
  });
});
