import { describe, expect, it } from "vitest";

import path from "node:path";

import { withMcpHttpServer, withTempDir } from "./httpTestUtils.js";
import {
  MCP_PROTOCOL_VERSION,
  mcpInitializeRaw,
} from "./httpTransport.responseFormat.testUtils.js";

describe("MCP HTTP server (Streamable HTTP response format)", () => {
  describe("notification-only POST bodies", () => {
    it("returns parseable JSON for notification-only POST bodies (compat)", async () => {
      await withTempDir("ailss-mcp-http-", async (dir) => {
        const dbPath = path.join(dir, "index.sqlite");

        await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
          for (const accept of ["application/json", "text/event-stream"]) {
            const initRes = await mcpInitializeRaw({
              url,
              token,
              clientName: `client-notify-${accept.replace(/[^a-z0-9]+/gi, "-")}`,
              accept,
            });

            expect(initRes.status).toBe(200);
            expect(initRes.sessionId).toBeTruthy();

            const res = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: accept,
                "Content-Type": "application/json",
                "Mcp-Session-Id": initRes.sessionId as string,
                "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/initialized",
                params: {},
              }),
            });

            expect(res.status).toBe(202);
            expect((res.headers.get("content-type") ?? "").startsWith("application/json")).toBe(
              true,
            );
            expect((await res.text()).trim()).toBe("null");
          }

          const batchInit = await mcpInitializeRaw({
            url,
            token,
            clientName: "client-notify-batch",
            accept: "application/json",
          });

          expect(batchInit.status).toBe(200);
          expect(batchInit.sessionId).toBeTruthy();

          const batchRes = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              "Mcp-Session-Id": batchInit.sessionId as string,
              "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
            },
            body: JSON.stringify([
              {
                jsonrpc: "2.0",
                method: "notifications/initialized",
                params: {},
              },
            ]),
          });

          expect(batchRes.status).toBe(202);
          expect((batchRes.headers.get("content-type") ?? "").startsWith("application/json")).toBe(
            true,
          );
          expect((await batchRes.text()).trim()).toBe("[]");
        });
      });
    });
  });
});
