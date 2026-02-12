import { describe, expect, it, vi } from "vitest";

import path from "node:path";

import {
  mcpInitializeExpectBadRequest,
  mcpInitializeExpectUnauthorized,
  mcpToolsListExpectBadRequest,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

const MCP_PROTOCOL_VERSION = "2025-03-26";

type BoundaryEvent = {
  event: string;
  status: number;
  request_id: string | number | null;
  method: string;
  path: string;
  accept: string | null;
  has_mcp_session_id: boolean;
  reason: string;
};

describe("MCP HTTP server (boundary diagnostics)", () => {
  it("emits structured diagnostics for 400/401/404/406 early returns", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      let events: BoundaryEvent[] = [];

      try {
        await withMcpHttpServer({ dbPath }, async ({ url, token }) => {
          await mcpInitializeExpectUnauthorized(url, "wrong-token");
          await mcpInitializeExpectBadRequest(url, token);
          await mcpToolsListExpectBadRequest(url, token);

          const missingPathUrl = new URL(url);
          missingPathUrl.pathname = "/missing-path";
          const missingPathResponse = await fetch(missingPathUrl.toString());
          expect(missingPathResponse.status).toBe(404);
          await missingPathResponse.text();

          const notAcceptableResponse = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "text/plain",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 99,
              method: "initialize",
              params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: "diag-client", version: "0" },
              },
            }),
          });
          expect(notAcceptableResponse.status).toBe(406);
          await notAcceptableResponse.text();
        });
        events = parseBoundaryEvents(warnSpy);
      } finally {
        warnSpy.mockRestore();
      }

      expect(events.length).toBeGreaterThanOrEqual(5);

      const unauthorized = findByReason(events, "mcp_unauthorized");
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.request_id).toBe(null);
      expect(unauthorized.has_mcp_session_id).toBe(false);
      expect(unauthorized.path).toBe("/mcp");

      const invalidJson = findByReason(events, "invalid_json_body");
      expect(invalidJson.status).toBe(400);
      expect(invalidJson.request_id).toBe(null);

      const missingSessionId = findByReason(events, "missing_session_id_header");
      expect(missingSessionId.status).toBe(400);
      expect(missingSessionId.request_id).toBe(2);
      expect(missingSessionId.has_mcp_session_id).toBe(false);

      const pathNotFound = findByReason(events, "path_not_found");
      expect(pathNotFound.status).toBe(404);
      expect(pathNotFound.path).toBe("/missing-path");

      const notAcceptable = findByReason(events, "not_acceptable");
      expect(notAcceptable.status).toBe(406);
      expect(notAcceptable.request_id).toBe(99);
      expect(notAcceptable.accept).toBe("text/plain");

      for (const event of events) {
        expect(event.event).toBe("mcp_http_boundary_early_return");
        expect(typeof event.method).toBe("string");
        expect(typeof event.path).toBe("string");
        expect(typeof event.reason).toBe("string");
        expect(typeof event.has_mcp_session_id).toBe("boolean");
      }
    });
  });
});

function parseBoundaryEvents(warnSpy: { mock: { calls: unknown[][] } }): BoundaryEvent[] {
  return warnSpy.mock.calls
    .map((call: unknown[]) => call[0])
    .filter((line: unknown): line is string => typeof line === "string")
    .map((line: string) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value: unknown): value is BoundaryEvent => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      if ((value as Record<string, unknown>)["event"] !== "mcp_http_boundary_early_return") {
        return false;
      }
      return true;
    });
}

function findByReason(events: BoundaryEvent[], reason: string): BoundaryEvent {
  const match = events.find((event) => event.reason === reason);
  if (!match) {
    throw new Error(`Missing boundary diagnostic event for reason=${reason}`);
  }
  return match;
}
