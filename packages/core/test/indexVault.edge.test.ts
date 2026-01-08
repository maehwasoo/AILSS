import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { indexVault, listFilePaths, openAilssDb } from "../src/index.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("indexVault() edge cases", () => {
  it("increments deletedFiles when an explicitly requested file is missing", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });

      const notePath = path.join(vaultPath, "Note.md");
      await fs.writeFile(notePath, "# Note\nhello\n", "utf8");

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const embedTexts = async (inputs: string[]): Promise<number[][]> =>
        inputs.map(() => [0.1, 0.2, 0.3]);

      try {
        await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          maxChars: 4000,
          batchSize: 32,
        });

        expect(listFilePaths(db)).toEqual(["Note.md"]);

        await fs.unlink(notePath);

        const summary = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          paths: ["Note.md"],
          maxChars: 4000,
          batchSize: 32,
        });

        expect(summary.deletedFiles).toBe(1);
        expect(summary.changedFiles).toBe(0);
        expect(summary.indexedChunks).toBe(0);
        expect(listFilePaths(db)).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  it("increments deletedFiles when a file disappears during a full-vault run", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });

      const a = path.join(vaultPath, "A.md");
      const b = path.join(vaultPath, "B.md");
      await fs.writeFile(a, "# A\nhello\n", "utf8");
      await fs.writeFile(b, "# B\nworld\n", "utf8");

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const embedTexts = async (inputs: string[]): Promise<number[][]> =>
        inputs.map(() => [0.1, 0.2, 0.3]);

      try {
        await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          maxChars: 4000,
          batchSize: 32,
        });

        expect(listFilePaths(db)).toEqual(["A.md", "B.md"]);

        await fs.unlink(b);

        const summary = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          maxChars: 4000,
          batchSize: 32,
        });

        expect(summary.deletedFiles).toBe(1);
        expect(listFilePaths(db)).toEqual(["A.md"]);
      } finally {
        db.close();
      }
    });
  });

  it("ignores default ignored directories in requested paths", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
      await fs.writeFile(path.join(vaultPath, ".obsidian", "Hidden.md"), "# hidden\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "Visible.md"), "# visible\n", "utf8");

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const embedTexts = async (inputs: string[]): Promise<number[][]> =>
        inputs.map(() => [0.1, 0.2, 0.3]);

      try {
        const summary = await indexVault({
          db,
          vaultPath,
          embeddingModel: "test-embeddings",
          embedTexts,
          paths: [".obsidian/Hidden.md", "Visible.md"],
          maxChars: 4000,
          batchSize: 32,
        });

        expect(summary.changedFiles).toBe(1);
        expect(listFilePaths(db)).toEqual(["Visible.md"]);
      } finally {
        db.close();
      }
    });
  });

  it("refuses to index requested paths outside the vault root", async () => {
    await withTempDir("ailss-core-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const embedTexts = async (inputs: string[]): Promise<number[][]> =>
        inputs.map(() => [0.1, 0.2, 0.3]);

      try {
        await expect(
          indexVault({
            db,
            vaultPath,
            embeddingModel: "test-embeddings",
            embedTexts,
            paths: ["../Outside.md"],
            maxChars: 4000,
            batchSize: 32,
          }),
        ).rejects.toThrow(/outside the vault/i);
      } finally {
        db.close();
      }
    });
  });
});
