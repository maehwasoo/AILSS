import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import { insertChunkWithEmbedding, openAilssDb, upsertFile } from "@ailss/core";

import { getStructuredContent, mcpInitialize, mcpToolsCall, withTempDir } from "./httpTestUtils.js";
import { TEST_TOKEN, throwIfToolCallFailed } from "./httpTools.getContext.testUtils.js";

describe("MCP HTTP server (get_context)", () => {
  it("dedupes by path, orders by distance, and returns previews with truncation", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, "A.md"), "A".repeat(500) + "\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "B.md"), "short\n", "utf8");

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const queryEmbedding = [0, 0, 0];
      const openaiStub = {
        embeddings: {
          create: async () => ({ data: [{ embedding: queryEmbedding }] }),
        },
      } as unknown as AilssMcpRuntime["deps"]["openai"];

      const runtime: AilssMcpRuntime = {
        deps: {
          db,
          dbPath,
          vaultPath,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertFile(db, { path: "A.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertFile(db, { path: "B.md", mtimeMs: 0, sizeBytes: 0, sha256: "b" });

      // A.md has two chunk hits; the closer one should be chosen after dedupe.
      insertChunkWithEmbedding(db, {
        chunkId: "a-close",
        path: "A.md",
        chunkIndex: 0,
        heading: "A close",
        headingPathJson: JSON.stringify(["A close"]),
        content: "chunk-a-close",
        contentSha256: "sha-a-close",
        embedding: [0, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "a-far",
        path: "A.md",
        chunkIndex: 1,
        heading: "A far",
        headingPathJson: JSON.stringify(["A far"]),
        content: "chunk-a-far",
        contentSha256: "sha-a-far",
        embedding: [1, 0, 0],
      });

      insertChunkWithEmbedding(db, {
        chunkId: "b",
        path: "B.md",
        chunkIndex: 0,
        heading: "B",
        headingPathJson: JSON.stringify(["B"]),
        content: "chunk-b",
        contentSha256: "sha-b",
        embedding: [2, 0, 0],
      });

      const { close, url } = await startAilssMcpHttpServer({
        runtime,
        config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
        maxSessions: 5,
        idleTtlMs: 60_000,
      });

      try {
        const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-a");
        const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_context", {
          query: "query",
          top_k: 2,
          expand_top_k: 0,
          include_file_preview: true,
          max_chars_per_note: 200,
        });

        throwIfToolCallFailed(res);
        const structured = getStructuredContent(res);
        expect(structured["query"]).toBe("query");
        expect(structured["top_k"]).toBe(2);
        expect(structured["used_chunks_k"]).toBe(50);

        const results = structured["results"] as Array<Record<string, unknown>>;
        expect(results).toHaveLength(2);

        expect(results[0]?.path).toBe("A.md");
        expect(results[0]?.heading).toBe("A close");
        expect(results[0]?.snippet).toBe("chunk-a-close");
        expect(results[0]?.preview_truncated).toBe(true);
        expect(String(results[0]?.preview)).toBe("A".repeat(200));

        expect(results[1]?.path).toBe("B.md");
        expect(results[1]?.heading).toBe("B");
        expect(results[1]?.snippet).toBe("chunk-b");
        expect(results[1]?.preview_truncated).toBe(false);
        expect(String(results[1]?.preview)).toBe("short\n");
      } finally {
        await close();
        db.close();
      }
    });
  });
});
