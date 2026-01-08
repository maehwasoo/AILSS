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
        expect(embedCalls).toEqual([["hello", "world", "again"]]);

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
        expect(embedCalls[1]).toEqual(["world!"]);

        const chunkCount = db
          .prepare("SELECT COUNT(*) as count FROM chunks WHERE path = ?")
          .get("Note.md") as { count: number };
        expect(chunkCount.count).toBe(3);
      } finally {
        db.close();
      }
    });
  });
});
