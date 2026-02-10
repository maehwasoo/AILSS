import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { indexVault, openAilssDb } from "../src/index.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("indexVault() per-chunk reuse", () => {
  it("reuses embeddings for unchanged chunks when a file changes", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });

      const notePath = path.join(vaultPath, "Note.md");
      await fs.writeFile(
        notePath,
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "Note"',
          "---",
          "",
          "# A",
          "hello",
          "",
          "# B",
          "world",
          "",
          "# C",
          "again",
          "",
        ].join("\n"),
        "utf8",
      );

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const embedCalls: string[][] = [];
      const embedTexts = async (inputs: string[]): Promise<number[][]> => {
        embedCalls.push(inputs);
        return inputs.map((_, i) => [0.1 + i, 0.2 + i, 0.3 + i]);
      };

      try {
        const first = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          maxChars: 4000,
          batchSize: 32,
        });

        expect(first.changedFiles).toBe(1);
        expect(first.indexedChunks).toBe(3);
        expect(embedCalls).toEqual([["# A\nhello", "# B\nworld", "# C\nagain"]]);

        // Edit only the middle chunk.
        await fs.writeFile(
          notePath,
          [
            "---",
            'id: "20260108123456"',
            'created: "2026-01-08T12:34:56"',
            'title: "Note"',
            "---",
            "",
            "# A",
            "hello",
            "",
            "# B",
            "world!",
            "",
            "# C",
            "again",
            "",
          ].join("\n"),
          "utf8",
        );

        const second = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          paths: ["Note.md"],
          maxChars: 4000,
          batchSize: 32,
        });

        expect(second.changedFiles).toBe(1);
        expect(second.indexedChunks).toBe(3);
        expect(embedCalls[1]).toEqual(["# B\nworld!"]);

        const chunkCount = db
          .prepare("SELECT COUNT(*) as count FROM chunks WHERE path = ?")
          .get("Note.md") as { count: number };
        expect(chunkCount.count).toBe(3);
      } finally {
        db.close();
      }
    });
  });

  it("keeps chunk operation order: delete before embed, write after embed", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });

      const notePath = path.join(vaultPath, "Note.md");
      await fs.writeFile(
        notePath,
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "Note"',
          "---",
          "",
          "# A",
          "alpha",
          "",
          "# B",
          "bravo",
          "",
        ].join("\n"),
        "utf8",
      );

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      try {
        await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts: async (inputs: string[]): Promise<number[][]> =>
            inputs.map((_, i) => [0.1 + i, 0.2 + i, 0.3 + i]),
          maxChars: 4000,
          batchSize: 32,
        });

        const oldA = db
          .prepare(
            "SELECT chunk_id as chunkId, chunk_index as chunkIndex FROM chunks WHERE path = ? AND content = ?",
          )
          .get("Note.md", "# A\nalpha") as { chunkId: string; chunkIndex: number } | undefined;
        const oldB = db
          .prepare(
            "SELECT chunk_id as chunkId, chunk_index as chunkIndex FROM chunks WHERE path = ? AND content = ?",
          )
          .get("Note.md", "# B\nbravo") as { chunkId: string; chunkIndex: number } | undefined;

        if (!oldA || !oldB) {
          throw new Error("expected baseline chunks for order regression test");
        }

        expect(oldA.chunkIndex).toBe(0);
        expect(oldB.chunkIndex).toBe(1);

        await fs.writeFile(
          notePath,
          [
            "---",
            'id: "20260108123456"',
            'created: "2026-01-08T12:34:56"',
            'title: "Note"',
            "---",
            "",
            "# B",
            "bravo!",
            "",
            "# A",
            "alpha",
            "",
          ].join("\n"),
          "utf8",
        );

        const embedCalls: string[][] = [];
        let embedPhase: {
          oldBCount: number;
          oldAChunkIndex: number | null;
          newBCount: number;
        } | null = null;
        const embedTexts = async (inputs: string[]): Promise<number[][]> => {
          embedCalls.push(inputs);

          const oldBCount = db
            .prepare("SELECT COUNT(*) as count FROM chunks WHERE chunk_id = ?")
            .get(oldB.chunkId) as { count: number };
          const oldAState = db
            .prepare("SELECT chunk_index as chunkIndex FROM chunks WHERE chunk_id = ?")
            .get(oldA.chunkId) as { chunkIndex: number } | undefined;
          const newBCount = db
            .prepare("SELECT COUNT(*) as count FROM chunks WHERE path = ? AND content = ?")
            .get("Note.md", "# B\nbravo!") as { count: number };

          embedPhase = {
            oldBCount: oldBCount.count,
            oldAChunkIndex: oldAState?.chunkIndex ?? null,
            newBCount: newBCount.count,
          };

          return inputs.map((_, i) => [1.1 + i, 1.2 + i, 1.3 + i]);
        };

        const summary = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          paths: ["Note.md"],
          maxChars: 4000,
          batchSize: 32,
        });

        expect(summary.changedFiles).toBe(1);
        expect(summary.indexedChunks).toBe(2);
        expect(embedCalls).toEqual([["# B\nbravo!"]]);
        expect(embedPhase).toEqual({ oldBCount: 0, oldAChunkIndex: 0, newBCount: 0 });

        const finalChunks = db
          .prepare(
            "SELECT chunk_id as chunkId, chunk_index as chunkIndex, content FROM chunks WHERE path = ? ORDER BY chunk_index ASC",
          )
          .all("Note.md") as Array<{ chunkId: string; chunkIndex: number; content: string }>;

        expect(finalChunks).toHaveLength(2);
        expect(finalChunks.map((chunk) => chunk.content)).toEqual(["# B\nbravo!", "# A\nalpha"]);
        expect(finalChunks[1]?.chunkId).toBe(oldA.chunkId);
        expect(finalChunks.some((chunk) => chunk.chunkId === oldB.chunkId)).toBe(false);
      } finally {
        db.close();
      }
    });
  });
});
