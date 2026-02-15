import { describe, expect, it } from "vitest";

import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import { openAilssDb } from "@ailss/core";

import { getStructuredContent, mcpInitialize, mcpToolsCall, withTempDir } from "./httpTestUtils.js";
import {
  TEST_TOKEN,
  throwIfToolCallFailed,
  withGetContextDefaultTopKEnv,
} from "./httpTools.getContext.testUtils.js";

describe("MCP HTTP server (get_context)", () => {
  it.each([
    { env: undefined, expected: 10 },
    { env: "not-a-number", expected: 10 },
    { env: "3", expected: 3 },
    { env: "0", expected: 1 },
    { env: "999", expected: 50 },
  ])("uses env default top_k (env=$env -> $expected)", async ({ env, expected }) => {
    await withGetContextDefaultTopKEnv(env, async () => {
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

        const { close, url } = await startAilssMcpHttpServer({
          runtime,
          config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
          maxSessions: 1,
          idleTtlMs: 60_000,
        });

        try {
          const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-a");
          const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_context", {
            query: "query",
            max_chars_per_note: 200,
          });

          throwIfToolCallFailed(res);
          const structured = getStructuredContent(res);
          expect(structured["top_k"]).toBe(expected);
        } finally {
          await close();
          db.close();
        }
      });
    });
  });
});
