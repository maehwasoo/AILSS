import { describe, expect, it } from "vitest";

import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import {
  insertChunkWithEmbedding,
  openAilssDb,
  replaceNoteTags,
  upsertFile,
  upsertNote,
} from "@ailss/core";

import { getStructuredContent, mcpInitialize, mcpToolsCall, withTempDir } from "./httpTestUtils.js";
import { TEST_TOKEN, throwIfToolCallFailed } from "./httpTools.getContext.testUtils.js";

describe("MCP HTTP server (get_context)", () => {
  it("applies scoped filters before ranking and returns applied_filters metadata", async () => {
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

      upsertFile(db, { path: "Projects/Alpha.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertFile(db, { path: "Projects/Beta.md", mtimeMs: 0, sizeBytes: 0, sha256: "b" });
      upsertFile(db, { path: "Personal/Gamma.md", mtimeMs: 0, sizeBytes: 0, sha256: "c" });

      upsertNote(db, {
        path: "Projects/Alpha.md",
        noteId: "alpha",
        created: null,
        title: "Alpha",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        frontmatterJson: "{}",
      });
      upsertNote(db, {
        path: "Projects/Beta.md",
        noteId: "beta",
        created: null,
        title: "Beta",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        frontmatterJson: "{}",
      });
      upsertNote(db, {
        path: "Personal/Gamma.md",
        noteId: "gamma",
        created: null,
        title: "Gamma",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        frontmatterJson: "{}",
      });

      replaceNoteTags(db, "Projects/Alpha.md", ["project"]);
      replaceNoteTags(db, "Projects/Beta.md", ["project", "urgent"]);
      replaceNoteTags(db, "Personal/Gamma.md", ["urgent", "personal"]);

      insertChunkWithEmbedding(db, {
        chunkId: "alpha",
        path: "Projects/Alpha.md",
        chunkIndex: 0,
        heading: "Alpha",
        headingPathJson: JSON.stringify(["Alpha"]),
        content: "alpha",
        contentSha256: "sha-alpha",
        embedding: [0.3, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "beta",
        path: "Projects/Beta.md",
        chunkIndex: 0,
        heading: "Beta",
        headingPathJson: JSON.stringify(["Beta"]),
        content: "beta",
        contentSha256: "sha-beta",
        embedding: [0.2, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "gamma",
        path: "Personal/Gamma.md",
        chunkIndex: 0,
        heading: "Gamma",
        headingPathJson: JSON.stringify(["Gamma"]),
        content: "gamma",
        contentSha256: "sha-gamma",
        embedding: [0, 0, 0],
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
          path_prefix: "Projects/",
          tags_any: ["urgent"],
          tags_all: ["project"],
          top_k: 3,
          expand_top_k: 0,
        });

        throwIfToolCallFailed(res);
        const structured = getStructuredContent(res);
        expect(structured["applied_filters"]).toEqual({
          path_prefix: "Projects/",
          tags_any: ["urgent"],
          tags_all: ["project"],
        });

        const results = structured["results"] as Array<Record<string, unknown>>;
        expect(results).toHaveLength(1);
        expect(results[0]?.path).toBe("Projects/Beta.md");
      } finally {
        await close();
        db.close();
      }
    });
  });

  it("treats path_prefix as a literal prefix", async () => {
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

      upsertFile(db, { path: "project_v2/Alpha.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertFile(db, { path: "projectXv2/Beta.md", mtimeMs: 0, sizeBytes: 0, sha256: "b" });

      insertChunkWithEmbedding(db, {
        chunkId: "alpha",
        path: "project_v2/Alpha.md",
        chunkIndex: 0,
        heading: "Alpha",
        headingPathJson: JSON.stringify(["Alpha"]),
        content: "alpha",
        contentSha256: "sha-alpha",
        embedding: [0.3, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "beta",
        path: "projectXv2/Beta.md",
        chunkIndex: 0,
        heading: "Beta",
        headingPathJson: JSON.stringify(["Beta"]),
        content: "beta",
        contentSha256: "sha-beta",
        embedding: [0, 0, 0],
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
          path_prefix: "project_v2/",
          top_k: 2,
          expand_top_k: 0,
        });

        throwIfToolCallFailed(res);
        const structured = getStructuredContent(res);
        expect(structured["applied_filters"]).toEqual({
          path_prefix: "project_v2/",
          tags_any: [],
          tags_all: [],
        });

        const results = structured["results"] as Array<Record<string, unknown>>;
        expect(results).toHaveLength(1);
        expect(results[0]?.path).toBe("project_v2/Alpha.md");
      } finally {
        await close();
        db.close();
      }
    });
  });
});
