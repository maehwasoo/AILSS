import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  mcpDeleteSession,
  mcpDeleteSessionExpectSessionNotFound,
  mcpInitialize,
  mcpInitializeExpectBadRequest,
  mcpInitializeExpectUnauthorized,
  mcpToolsList,
  mcpToolsListExpectBadRequest,
  mcpToolsListExpectSessionNotFound,
  mcpToolsListWithDuplicateSessionIdHeaderExpectBadRequest,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (multi-session)", () => {
  it("supports multiple initialized sessions concurrently", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, maxSessions: 5, idleTtlMs: 60_000 },
        async ({ url, token }) => {
          const a = await mcpInitialize(url, token, "client-a");
          const b = await mcpInitialize(url, token, "client-b");
          expect(a).not.toBe(b);

          await mcpToolsList(url, token, a);
          await mcpToolsList(url, token, b);
        },
      );
    });
  });

  it("evicts old sessions when maxSessions is exceeded", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, maxSessions: 1, idleTtlMs: 60_000 },
        async ({ url, token }) => {
          const a = await mcpInitialize(url, token, "client-a");
          const b = await mcpInitialize(url, token, "client-b");
          expect(a).not.toBe(b);

          await mcpToolsList(url, token, b);
          await mcpToolsListExpectSessionNotFound(url, token, a);
        },
      );
    });
  });

  it("deletes sessions on DELETE and rejects further calls", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, maxSessions: 5, idleTtlMs: 60_000 },
        async ({ url, token }) => {
          const sessionId = await mcpInitialize(url, token, "client-a");
          await mcpToolsList(url, token, sessionId);

          await mcpDeleteSession(url, token, sessionId);
          await mcpDeleteSessionExpectSessionNotFound(url, token, sessionId);
          await mcpToolsListExpectSessionNotFound(url, token, sessionId);
        },
      );
    });
  });

  it("rejects unauthorized requests and missing/duplicate session headers", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, maxSessions: 5, idleTtlMs: 60_000 },
        async ({ url, token }) => {
          await mcpInitializeExpectUnauthorized(url, "wrong-token");

          const sessionId = await mcpInitialize(url, token, "client-a");
          await mcpToolsListExpectBadRequest(url, token);
          await mcpToolsListWithDuplicateSessionIdHeaderExpectBadRequest(
            url,
            token,
            sessionId,
            "other",
          );
          await mcpToolsList(url, token, sessionId);
        },
      );
    });
  });

  it("accepts trailing-slash MCP paths and returns JSON-RPC for malformed JSON", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, maxSessions: 5, idleTtlMs: 60_000 },
        async ({ url, token }) => {
          const u = new URL(url);
          u.pathname = `${u.pathname}/`;

          const sessionId = await mcpInitialize(u.toString(), token, "client-trailing-slash");
          await mcpToolsList(u.toString(), token, sessionId);

          await mcpInitializeExpectBadRequest(url, token);
        },
      );
    });
  });

  it("evicts idle sessions after idleTtlMs", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, maxSessions: 5, idleTtlMs: 10 }, async ({ url, token }) => {
        const a = await mcpInitialize(url, token, "client-a");
        const b = await mcpInitialize(url, token, "client-b");
        await new Promise((r) => setTimeout(r, 50));

        await mcpToolsList(url, token, b);
        await mcpToolsListExpectSessionNotFound(url, token, a);
      });
    });
  });

  it("does not evict an active session on the first request after a long idle", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, maxSessions: 5, idleTtlMs: 10 }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        await new Promise((r) => setTimeout(r, 50));
        await mcpToolsList(url, token, sessionId);
      });
    });
  });
});
