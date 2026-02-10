import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
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

import {
  getStructuredContent,
  assertArray,
  assertRecord,
  assertString,
  mcpInitialize,
  mcpToolsCall,
  withTempDir,
} from "./httpTestUtils.js";

const TEST_TOKEN = "test-token";
const DEFAULT_TOP_K_ENV_KEY = "AILSS_GET_CONTEXT_DEFAULT_TOP_K";

function getCallToolResult(payload: unknown): Record<string, unknown> {
  assertRecord(payload, "JSON-RPC payload");
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  return result;
}

function throwIfToolCallFailed(payload: unknown): void {
  const result = getCallToolResult(payload);
  if (!result["isError"]) return;

  const content = result["content"];
  assertArray(content, "result.content");
  const first = content[0];
  assertRecord(first, "result.content[0]");
  const text = first["type"] === "text" ? first["text"] : JSON.stringify(first);
  assertString(text, "result.content[0].text");
  throw new Error(`get_context failed: ${text}`);
}

async function withGetContextDefaultTopKEnv(
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[DEFAULT_TOP_K_ENV_KEY];
  if (value === undefined) {
    delete process.env[DEFAULT_TOP_K_ENV_KEY];
  } else {
    process.env[DEFAULT_TOP_K_ENV_KEY] = value;
  }

  try {
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[DEFAULT_TOP_K_ENV_KEY];
    } else {
      process.env[DEFAULT_TOP_K_ENV_KEY] = prev;
    }
  }
}

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
