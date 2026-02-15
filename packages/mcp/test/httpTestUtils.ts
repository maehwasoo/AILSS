import { expect } from "vitest";

import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { createAilssMcpRuntimeFromEnv } from "../src/createAilssMcpServer.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

type EnvKey =
  | "OPENAI_API_KEY"
  | "OPENAI_EMBEDDING_MODEL"
  | "AILSS_DB_PATH"
  | "AILSS_VAULT_PATH"
  | "AILSS_ENABLE_WRITE_TOOLS"
  | "AILSS_MCP_HTTP_MAX_SESSIONS"
  | "AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE";

export type EnvOverrides = Partial<Record<EnvKey, string | undefined>>;

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function withEnv<T>(overrides: EnvOverrides, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(overrides) as EnvKey[];
  const saved: Partial<Record<EnvKey, string | undefined>> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }

  for (const key of keys) {
    if (!(key in overrides)) continue;
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export type McpHttpServerTestOptions = {
  dbPath?: string;
  vaultPath?: string;
  enableWriteTools?: boolean;
  enableJsonResponseEnv?: string;
  token?: string;
  shutdownToken?: string;
  maxSessions?: number;
  idleTtlMs?: number;
  beforeStart?: (runtime: AilssMcpRuntime) => void | Promise<void>;
};

function envForMcpRuntime(
  options: Pick<
    McpHttpServerTestOptions,
    "dbPath" | "vaultPath" | "enableWriteTools" | "enableJsonResponseEnv"
  >,
) {
  if (options.dbPath && options.vaultPath) {
    throw new Error("Test misconfiguration: provide only one of dbPath or vaultPath");
  }
  if (!options.dbPath && !options.vaultPath) {
    throw new Error("Test misconfiguration: provide dbPath or vaultPath");
  }

  // NOTE: `loadEnv()` loads `.env` without overriding already-set variables.
  // To ensure tests don't accidentally pick up user-local settings, set empty
  // strings (not deletes) for "unset" values.
  const overrides: EnvOverrides = {
    OPENAI_API_KEY: "test",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    AILSS_DB_PATH: "",
    AILSS_VAULT_PATH: "",
    AILSS_ENABLE_WRITE_TOOLS: "",
    AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE: options.enableJsonResponseEnv ?? "1",
  };

  if (options.dbPath) {
    overrides.AILSS_DB_PATH = options.dbPath;
    overrides.AILSS_VAULT_PATH = "";
  }

  if (options.vaultPath) {
    overrides.AILSS_DB_PATH = "";
    overrides.AILSS_VAULT_PATH = options.vaultPath;
  }

  overrides.AILSS_ENABLE_WRITE_TOOLS = options.enableWriteTools ? "1" : "";

  return overrides;
}

export async function withMcpHttpServer<T>(
  options: McpHttpServerTestOptions,
  fn: (ctx: {
    url: string;
    token: string;
    shutdownToken: string | null;
    runtime: AilssMcpRuntime;
  }) => Promise<T>,
): Promise<T> {
  const token = options.token ?? "test-token";
  const shutdownToken = options.shutdownToken ?? null;
  const maxSessions = options.maxSessions ?? 5;
  const idleTtlMs = options.idleTtlMs ?? 60_000;

  return await withEnv(envForMcpRuntime(options), async () => {
    const runtime = await createAilssMcpRuntimeFromEnv();
    await options.beforeStart?.(runtime);

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions,
      idleTtlMs,
      ...(shutdownToken ? { shutdown: { token: shutdownToken } } : {}),
    });

    try {
      return await fn({ url, token, shutdownToken, runtime });
    } finally {
      await close();
      runtime.deps.db.close();
    }
  });
}

export function parseFirstMcpPayload(body: string): unknown {
  const normalized = (body ?? "").trim();
  if (!normalized) {
    throw new Error("Expected response body to be non-empty");
  }

  // SSE mode: `text/event-stream` with `data: { ... }`
  const dataLine = normalized
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data: "));
  if (dataLine) {
    return JSON.parse(dataLine.slice("data: ".length)) as unknown;
  }

  // JSON response mode: `application/json` with a plain JSON-RPC payload.
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse MCP response body as SSE or JSON: ${message}. Body: ${normalized.slice(
        0,
        500,
      )}`,
    );
  }
}

// Backwards-compatible alias (historically SSE-only).
export const parseFirstSseData = parseFirstMcpPayload;

export function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
}

export function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array`);
  }
}

export function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string`);
  }
}

export function getStructuredContent(payload: unknown): Record<string, unknown> {
  assertRecord(payload, "JSON-RPC payload");
  const error = payload["error"];
  if (error !== undefined) {
    throw new Error(`JSON-RPC error response: ${JSON.stringify(error)}`);
  }
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  const structured = result["structuredContent"];
  if (structured === undefined) {
    throw new Error(`Missing structuredContent. JSON-RPC result: ${JSON.stringify(result)}`);
  }
  assertRecord(structured, "structuredContent");
  return structured;
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
