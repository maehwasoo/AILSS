import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  assertRecord,
  parseFirstMcpPayload,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

async function mcpInitializeRaw(options: {
  url: string;
  token: string;
  clientName: string;
  accept: string;
}): Promise<{
  status: number;
  contentType: string;
  sessionId: string | null;
  body: string;
  payload: unknown;
}> {
  const res = await fetch(options.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: options.accept,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: options.clientName, version: "0" },
      },
    }),
  });

  const status = res.status;
  const contentType = res.headers.get("content-type") ?? "";
  const sessionId = res.headers.get("mcp-session-id");

  const body = await res.text();
  const payload = parseFirstMcpPayload(body);
  return { status, contentType, sessionId, body, payload };
}

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

  it("accepts */* clients for GET SSE stream in JSON response mode (compat)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const initRes = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-any-get-sse",
          accept: "*/*",
        });

        expect(initRes.status).toBe(200);
        expect(initRes.sessionId).toBeTruthy();

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "*/*",
            "mcp-session-id": initRes.sessionId as string,
          },
        });

        expect(res.status).toBe(200);
        expect((res.headers.get("content-type") ?? "").startsWith("text/event-stream")).toBe(true);

        if (res.body) {
          await res.body.cancel();
        }
      });
    });
  });

  it("does not coerce JSON-only clients for GET SSE stream in JSON response mode", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const initRes = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-json-only-get-sse",
          accept: "*/*",
        });

        expect(initRes.status).toBe(200);
        expect(initRes.sessionId).toBeTruthy();

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "mcp-session-id": initRes.sessionId as string,
          },
        });

        expect(res.status).toBe(406);
        expect((res.headers.get("content-type") ?? "").length > 0).toBe(true);

        const body = await res.text();
        const payload = parseFirstMcpPayload(body);
        assertRecord(payload, "error payload");
        expect(payload).toHaveProperty("error.message");
      });
    });
  });

  it("does not coerce GET clients that reject SSE via q-values", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const initRes = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-rejects-sse-get-sse",
          accept: "*/*",
        });

        expect(initRes.status).toBe(200);
        expect(initRes.sessionId).toBeTruthy();

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/*;q=0, application/json",
            "mcp-session-id": initRes.sessionId as string,
          },
        });

        expect(res.status).toBe(406);
        expect((res.headers.get("content-type") ?? "").length > 0).toBe(true);

        const body = await res.text();
        const payload = parseFirstMcpPayload(body);
        assertRecord(payload, "error payload");
        expect(payload).toHaveProperty("error.message");
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

  it("rejects clients that do not accept both application/json and text/event-stream", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const res = await mcpInitializeRaw({
          url,
          token,
          clientName: "client-sse-only",
          accept: "text/event-stream",
        });

        expect(res.status).toBe(406);
        expect(res.sessionId).toBeFalsy();
        assertRecord(res.payload, "error payload");
        expect(res.payload).toHaveProperty("error.message");
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
