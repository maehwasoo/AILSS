import { describe, expect, it } from "vitest";

import path from "node:path";

import { assertRecord, withMcpHttpServer, withTempDir } from "./httpTestUtils.js";
import { mcpInitializeRaw } from "./httpTransport.responseFormat.testUtils.js";

describe("MCP HTTP server (Streamable HTTP response format)", () => {
  it("returns JSON by default when client accepts JSON", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json",
          accept: "application/json, text/event-stream",
        });

        expect(res.status).toBe(200);
        expect(res.contentType.startsWith("application/json")).toBe(true);
        expect(res.sessionId).toBeTruthy();
        assertRecord(res.payload, "initialize payload");
        expect(res.payload).toHaveProperty("result");
      });
    });
  });

  it("accepts JSON-only clients in JSON response mode (compat)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-only",
          accept: "application/json",
        });

        expect(res.status).toBe(200);
        expect(res.contentType.startsWith("application/json")).toBe(true);
        expect(res.sessionId).toBeTruthy();
        assertRecord(res.payload, "initialize payload");
        expect(res.payload).toHaveProperty("result");
      });
    });
  });

  it("accepts */* clients in JSON response mode (compat)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-any",
          accept: "*/*",
        });

        expect(res.status).toBe(200);
        expect(res.contentType.startsWith("application/json")).toBe(true);
        expect(res.sessionId).toBeTruthy();
        assertRecord(res.payload, "initialize payload");
        expect(res.payload).toHaveProperty("result");
      });
    });
  });

  it("does not coerce clients that explicitly reject application/json (q=0)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-q0",
          accept: "application/json;q=0",
        });

        expect(res.status).toBe(406);
        expect(res.sessionId).toBeFalsy();
        assertRecord(res.payload, "error payload");
        expect(res.payload).toHaveProperty("error.message");
      });
    });
  });

  it("does not coerce parameterized application/json without generic fallback (e.g. profile)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-profile-only",
          accept: "application/json;profile=v1",
        });

        expect(res.status).toBe(406);
        expect(res.sessionId).toBeFalsy();
        assertRecord(res.payload, "error payload");
        expect(res.payload).toHaveProperty("error.message");
      });
    });
  });

  it("accepts parameterized application/json when */* fallback is present (compat)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-profile-with-any",
          accept: "application/json;profile=v1, */*",
        });

        expect(res.status).toBe(200);
        expect(res.contentType.startsWith("application/json")).toBe(true);
        expect(res.sessionId).toBeTruthy();
        assertRecord(res.payload, "initialize payload");
        expect(res.payload).toHaveProperty("result");
      });
    });
  });

  it("does not treat application/json-* subtypes as application/json for coercion", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-seq",
          accept: "application/json-seq",
        });

        expect(res.status).toBe(406);
        expect(res.sessionId).toBeFalsy();
        assertRecord(res.payload, "error payload");
        expect(res.payload).toHaveProperty("error.message");
      });
    });
  });

  it("accepts SSE-only clients by selecting SSE response mode (compat)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-sse-only",
          accept: "text/event-stream",
        });

        expect(res.status).toBe(200);
        expect(res.contentType.startsWith("text/event-stream")).toBe(true);
        expect(res.sessionId).toBeTruthy();
        assertRecord(res.payload, "initialize payload");
        expect(res.payload).toHaveProperty("result");
      });
    });
  });

  it("forces SSE when AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE=0", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, enableWriteTools: false, enableJsonResponseEnv: "0" },
        async ({ url, token }) => {
          const res = await mcpInitializeRaw({
            url,
            token,
            clientName: "client-forced-sse",
            accept: "application/json, text/event-stream",
          });

          expect(res.status).toBe(200);
          expect(res.contentType.startsWith("text/event-stream")).toBe(true);
          expect(res.sessionId).toBeTruthy();
          assertRecord(res.payload, "initialize payload");
          expect(res.payload).toHaveProperty("result");
        },
      );
    });
  });
});
