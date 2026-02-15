import { expect } from "vitest";

import http from "node:http";

import { assertRecord } from "./assert.js";
import { parseFirstMcpPayload } from "./parse.js";

const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

function expectSessionNotFoundWithRecoveryHint(
  payload: unknown,
  expectedId: string | number | null,
): void {
  assertRecord(payload, "JSON-RPC session-not-found payload");
  expect(payload["id"]).toBe(expectedId);
  const error = payload["error"];
  assertRecord(error, "JSON-RPC error");

  expect(error["code"]).toBe(-32001);
  expect(error["message"]).toBe("Session not found");

  const data = error["data"];
  assertRecord(data, "JSON-RPC error.data");
  expect(data).toMatchObject({
    reason: "session_expired_or_evicted",
    reinitializeRequired: true,
    retryRequest: true,
  });
}

function expectJsonRpcError(
  payload: unknown,
  expected: { code: number; messagePrefix: string },
): void {
  assertRecord(payload, "JSON-RPC error payload");
  const error = payload["error"];
  assertRecord(error, "JSON-RPC error");

  expect(error["code"]).toBe(expected.code);
  expect(typeof error["message"]).toBe("string");
  expect((error["message"] as string).startsWith(expected.messagePrefix)).toBe(true);
}

export async function mcpInitialize(
  url: string,
  token: string,
  clientName: string,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: clientName, version: "0" },
      },
    }),
  });

  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await res.text();
  return sessionId as string;
}

export async function mcpInitializeExpectUnauthorized(url: string, token: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "client", version: "0" },
      },
    }),
  });

  expect(res.status).toBe(401);
  expect(res.headers.get("mcp-session-id")).toBeFalsy();
  expectJsonRpcError(await res.json(), {
    code: -32000,
    messagePrefix: "Unauthorized",
  });
}

export async function mcpInitializeExpectBadRequest(url: string, token: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: "{",
  });

  expect(res.status).toBe(400);
  expectJsonRpcError(await res.json(), {
    code: -32000,
    messagePrefix: "Bad Request:",
  });
}

export async function mcpDeleteSession(
  url: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
  });

  expect(res.status).toBe(200);
  // Streamable HTTP SDK returns empty body on successful DELETE; avoid advertising JSON content-type.
  expect(res.headers.get("content-type")).toBeFalsy();
  const body = await res.text();
  expect(body).toBe("");
}

export async function mcpDeleteSessionExpectSessionNotFound(
  url: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
  });

  expect(res.status).toBe(404);
  expectSessionNotFoundWithRecoveryHint(await res.json(), null);
}

export async function mcpToolsCall(
  url: string,
  token: string,
  sessionId: string,
  name: string,
  args: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  expect(res.status).toBe(200);
  return parseFirstMcpPayload(await res.text());
}

export async function mcpToolsList(url: string, token: string, sessionId: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(200);
  const payload = parseFirstMcpPayload(await res.text());

  assertRecord(payload, "tools/list payload");
  expect(payload).toHaveProperty("result.tools");
  const result = payload["result"];
  assertRecord(result, "tools/list result");
  const tools = result["tools"];
  expect(Array.isArray(tools)).toBe(true);
}

export async function mcpToolsListExpectSessionNotFound(
  url: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(404);
  expectSessionNotFoundWithRecoveryHint(await res.json(), 2);
}

export async function mcpToolsListExpectBadRequest(url: string, token: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(400);
  const payload = (await res.json()) as {
    id?: unknown;
    error?: { code?: number; message?: string };
  };
  expect(payload.error?.code).toBe(-32000);
  expect(payload.id).toBe(2);
}

export async function mcpToolsListWithDuplicateSessionIdHeaderExpectBadRequest(
  url: string,
  token: string,
  sessionIdA: string,
  sessionIdB: string,
): Promise<void> {
  const u = new URL(url);

  const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
          "Mcp-Session-Id": [sessionIdA, sessionIdB],
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );

    req.on("error", (error) => reject(error));
    req.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    );
  });

  expect(res.status).toBe(400);
  const payload = JSON.parse(res.body) as { error?: { code?: number; message?: string } };
  expect(payload.error?.code).toBe(-32000);
}
