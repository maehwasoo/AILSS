import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type OpenAI from "openai";

import { openAilssDb } from "@ailss/core";

import { indexVault } from "../src/indexVault.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("indexVault (wrapper)", () => {
  it("indexes markdown files using the provided OpenAI client", async () => {
    await withTempDir("ailss-indexer-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(
        path.join(vaultPath, "Note.md"),
        ["---", "id: 20260108123456", "---", "Hello"].join("\n") + "\n",
        "utf8",
      );

      const embeddingModel = "text-embedding-3-large";
      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel, embeddingDim: 3 });

      const calls: Array<{ model: string; input: string[]; encoding_format?: string }> = [];
      const openai = {
        embeddings: {
          create: async (params: unknown) => {
            const p = params as { model?: string; input?: unknown; encoding_format?: string };
            const inputs = Array.isArray(p.input) ? (p.input as string[]) : [String(p.input ?? "")];
            const call = {
              model: String(p.model ?? ""),
              input: inputs,
              ...(typeof p.encoding_format === "string"
                ? { encoding_format: p.encoding_format }
                : {}),
            } satisfies { model: string; input: string[]; encoding_format?: string };
            calls.push(call);

            return { data: inputs.map(() => ({ embedding: [0.1, 0.2, 0.3] })) };
          },
        },
      } as unknown as OpenAI;

      try {
        const summary = await indexVault({
          db,
          dbPath,
          vaultPath,
          openai,
          embeddingModel,
          maxChars: 4000,
          batchSize: 32,
        });

        expect(summary).toEqual({ changedFiles: 1, indexedChunks: 1, deletedFiles: 0 });

        expect(calls.length).toBe(1);
        expect(calls[0]).toEqual({
          model: embeddingModel,
          input: ["Hello"],
          encoding_format: "float",
        });

        const note = db.prepare("SELECT note_id FROM notes WHERE path = ?").get("Note.md") as
          | { note_id: string | null }
          | undefined;
        expect(note?.note_id).toBe("20260108123456");

        const chunks = db.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
          count: number;
        };
        expect(chunks.count).toBe(1);
      } finally {
        db.close();
      }
    });
  });
});
