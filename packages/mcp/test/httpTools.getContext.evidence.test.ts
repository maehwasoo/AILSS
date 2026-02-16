import { describe, expect, it } from "vitest";

import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import { insertChunkWithEmbedding, openAilssDb, upsertFile } from "@ailss/core";

import { getStructuredContent, mcpInitialize, mcpToolsCall, withTempDir } from "./httpTestUtils.js";
import { TEST_TOKEN, throwIfToolCallFailed } from "./httpTools.getContext.testUtils.js";

describe("MCP HTTP server (get_context)", () => {
  it("returns stitched evidence chunks (hits + neighbors) without file-start previews by default", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
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
          vaultPath: undefined,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertFile(db, { path: "A.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });

      // Best hit at chunk_index=1; neighbors are 0 and 2; second hit is far away at 5.
      insertChunkWithEmbedding(db, {
        chunkId: "a-0",
        path: "A.md",
        chunkIndex: 0,
        heading: "Zero",
        headingPathJson: JSON.stringify(["Zero"]),
        content: "chunk-0",
        contentSha256: "sha-a-0",
        embedding: [2, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "a-1-best",
        path: "A.md",
        chunkIndex: 1,
        heading: "Best",
        headingPathJson: JSON.stringify(["Best"]),
        content: "chunk-1-best",
        contentSha256: "sha-a-1",
        embedding: [0, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "a-2",
        path: "A.md",
        chunkIndex: 2,
        heading: "Two",
        headingPathJson: JSON.stringify(["Two"]),
        content: "chunk-2",
        contentSha256: "sha-a-2",
        embedding: [2, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "a-5-hit",
        path: "A.md",
        chunkIndex: 5,
        heading: "Far hit",
        headingPathJson: JSON.stringify(["Far hit"]),
        content: "chunk-5-hit",
        contentSha256: "sha-a-5",
        embedding: [0.2, 0, 0],
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
          top_k: 1,
        });

        throwIfToolCallFailed(res);
        const structured = getStructuredContent(res);

        const results = structured["results"] as Array<Record<string, unknown>>;
        expect(results).toHaveLength(1);

        const first = results[0] ?? {};
        expect(first["path"]).toBe("A.md");

        // Preview is disabled by default.
        expect(first["preview"]).toBe(null);
        expect(first["preview_truncated"]).toBe(false);

        // Evidence stitching includes best hit + neighbors (0/1/2) + extra hit (5).
        expect(String(first["evidence_text"])).toContain("chunk-0");
        expect(String(first["evidence_text"])).toContain("chunk-1-best");
        expect(String(first["evidence_text"])).toContain("chunk-2");
        expect(String(first["evidence_text"])).toContain("chunk-5-hit");

        const evidenceChunks = first["evidence_chunks"] as Array<Record<string, unknown>>;
        const indices = evidenceChunks
          .map((c) => c["chunk_index"])
          .sort((a, b) => Number(a) - Number(b));
        expect(indices).toEqual([0, 1, 2, 5]);
      } finally {
        await close();
        db.close();
      }
    });
  });
});
