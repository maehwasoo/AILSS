import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  assertRecord,
  parseFirstMcpPayload,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";
import { mcpInitializeRaw } from "./httpTransport.responseFormat.testUtils.js";

describe("MCP HTTP server (Streamable HTTP response format)", () => {
  describe("GET SSE stream", () => {
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
          expect((res.headers.get("content-type") ?? "").startsWith("text/event-stream")).toBe(
            true,
          );

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

    it("does not coerce parameterized wildcard Accept for GET SSE stream", async () => {
      await withTempDir("ailss-mcp-http-", async (dir) => {
        const dbPath = path.join(dir, "index.sqlite");

        await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
          const initRes = await mcpInitializeRaw({
            url,
            token,
            clientName: "client-param-wildcard-get-sse",
            accept: "*/*",
          });

          expect(initRes.status).toBe(200);
          expect(initRes.sessionId).toBeTruthy();

          const res = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "*/*;profile=v1",
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
  });
});
