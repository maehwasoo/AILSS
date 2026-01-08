import { afterEach, describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { parseMarkdownNote } from "@ailss/core";

import { createAilssMcpRuntimeFromEnv } from "../src/createAilssMcpServer.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

let tempDir: string | null = null;

async function mkTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-mcp-http-"));
  tempDir = dir;
  return dir;
}

afterEach(async () => {
  if (!tempDir) return;
  await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function mcpInitialize(url: string, token: string, clientName: string): Promise<string> {
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
        protocolVersion: "2025-03-26",
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

async function mcpToolsList(url: string, token: string, sessionId: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const dataLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data: "));
  expect(dataLine).toBeTruthy();

  const payload = JSON.parse((dataLine as string).slice("data: ".length));
  expect(payload).toHaveProperty("result.tools");
  expect(Array.isArray(payload.result.tools)).toBe(true);
}

async function mcpToolsListExpectSessionNotFound(
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
      "Mcp-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(404);
  const payload = (await res.json()) as { error?: { code?: number; message?: string } };
  expect(payload.error?.code).toBe(-32001);
}

function parseFirstSseData(body: string): unknown {
  const dataLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data: "));
  expect(dataLine).toBeTruthy();
  return JSON.parse((dataLine as string).slice("data: ".length)) as unknown;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string`);
  }
}

function getStructuredContent(payload: unknown): Record<string, unknown> {
  assertRecord(payload, "JSON-RPC payload");
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  const structured = result["structuredContent"];
  assertRecord(structured, "structuredContent");
  return structured;
}

async function mcpToolsListExpectBadRequest(url: string, token: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(400);
  const payload = (await res.json()) as { error?: { code?: number; message?: string } };
  expect(payload.error?.code).toBe(-32000);
}

async function mcpToolsListWithDuplicateSessionIdHeaderExpectBadRequest(
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
          "Mcp-Protocol-Version": "2025-03-26",
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

async function mcpInitializeExpectUnauthorized(url: string, token: string): Promise<void> {
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
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "client", version: "0" },
      },
    }),
  });

  expect(res.status).toBe(401);
  expect(res.headers.get("mcp-session-id")).toBeFalsy();
  expect(await res.text()).toBe("unauthorized");
}

async function mcpDeleteSession(url: string, token: string, sessionId: string): Promise<void> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": "2025-03-26",
    },
  });

  expect(res.status).toBe(200);
  await res.text();
}

async function mcpToolsCall(
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
      "Mcp-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  expect(res.status).toBe(200);
  return parseFirstSseData(await res.text());
}

describe("MCP HTTP server (multi-session)", () => {
  it("supports multiple initialized sessions concurrently", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    process.env.AILSS_DB_PATH = dbPath;
    delete process.env.AILSS_VAULT_PATH;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const a = await mcpInitialize(url, token, "client-a");
      const b = await mcpInitialize(url, token, "client-b");
      expect(a).not.toBe(b);

      await mcpToolsList(url, token, a);
      await mcpToolsList(url, token, b);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("evicts old sessions when maxSessions is exceeded", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    process.env.AILSS_DB_PATH = dbPath;
    delete process.env.AILSS_VAULT_PATH;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 1,
      idleTtlMs: 60_000,
    });

    try {
      const a = await mcpInitialize(url, token, "client-a");
      const b = await mcpInitialize(url, token, "client-b");
      expect(a).not.toBe(b);

      await mcpToolsList(url, token, b);
      await mcpToolsListExpectSessionNotFound(url, token, a);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("deletes sessions on DELETE and rejects further calls", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    process.env.AILSS_DB_PATH = dbPath;
    delete process.env.AILSS_VAULT_PATH;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");
      await mcpToolsList(url, token, sessionId);

      await mcpDeleteSession(url, token, sessionId);
      await mcpToolsListExpectSessionNotFound(url, token, sessionId);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("rejects unauthorized requests and missing/duplicate session headers", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    process.env.AILSS_DB_PATH = dbPath;
    delete process.env.AILSS_VAULT_PATH;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
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
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("evicts idle sessions after idleTtlMs", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    process.env.AILSS_DB_PATH = dbPath;
    delete process.env.AILSS_VAULT_PATH;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 10,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");
      await new Promise((r) => setTimeout(r, 50));
      await mcpToolsListExpectSessionNotFound(url, token, sessionId);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("serializes write tools across sessions (writeLock)", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;

    await fs.writeFile(path.join(vaultPath, "A.md"), "a\n", "utf8");
    await fs.writeFile(path.join(vaultPath, "B.md"), "b\n", "utf8");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    process.env.AILSS_ENABLE_WRITE_TOOLS = "1";

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const underlyingLock = runtime.deps.writeLock;
    expect(underlyingLock).toBeTruthy();

    let entered1Resolve: (() => void) | undefined;
    const entered1 = new Promise<void>((resolve) => {
      entered1Resolve = resolve;
    });

    let attempted2Resolve: (() => void) | undefined;
    const attempted2 = new Promise<void>((resolve) => {
      attempted2Resolve = resolve;
    });

    let releaseHoldResolve: (() => void) | undefined;
    const releaseHold = new Promise<void>((resolve) => {
      releaseHoldResolve = resolve;
    });

    const events: Array<{ type: "attempt" | "enter" | "exit"; callId: number; at: number }> = [];
    let callSeq = 0;

    runtime.deps.writeLock = {
      runExclusive: async <T>(fn: () => Promise<T>): Promise<T> => {
        const callId = (callSeq += 1);
        events.push({ type: "attempt", callId, at: Date.now() });
        if (callId === 2) attempted2Resolve?.();

        return await underlyingLock!.runExclusive(async () => {
          events.push({ type: "enter", callId, at: Date.now() });
          if (callId === 1) {
            entered1Resolve?.();
            await releaseHold;
          }

          try {
            return await fn();
          } finally {
            events.push({ type: "exit", callId, at: Date.now() });
          }
        });
      },
    };

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const s1 = await mcpInitialize(url, token, "client-a");
      const s2 = await mcpInitialize(url, token, "client-b");

      const call1 = mcpToolsCall(url, token, s1, "edit_note", {
        path: "A.md",
        apply: true,
        reindex_after_apply: false,
        ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "a1" }],
      });

      await entered1;

      const call2 = mcpToolsCall(url, token, s2, "edit_note", {
        path: "B.md",
        apply: true,
        reindex_after_apply: false,
        ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "b1" }],
      });

      await attempted2;
      releaseHoldResolve?.();

      await Promise.all([call1, call2]);

      const enter1 = events.find((e) => e.type === "enter" && e.callId === 1);
      const exit1 = events.find((e) => e.type === "exit" && e.callId === 1);
      const enter2 = events.find((e) => e.type === "enter" && e.callId === 2);
      const attempt2 = events.find((e) => e.type === "attempt" && e.callId === 2);
      const exit1Index = events.findIndex((e) => e.type === "exit" && e.callId === 1);
      const enter2Index = events.findIndex((e) => e.type === "enter" && e.callId === 2);
      const attempt2Index = events.findIndex((e) => e.type === "attempt" && e.callId === 2);

      expect(enter1).toBeTruthy();
      expect(exit1).toBeTruthy();
      expect(enter2).toBeTruthy();
      expect(attempt2).toBeTruthy();

      expect(attempt2Index).toBeGreaterThanOrEqual(0);
      expect(exit1Index).toBeGreaterThanOrEqual(0);
      expect(enter2Index).toBeGreaterThanOrEqual(0);

      expect(attempt2Index).toBeLessThan(exit1Index);
      expect(enter2Index).toBeGreaterThan(exit1Index);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("creates a new note via new_note (dry-run + apply)", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    process.env.AILSS_ENABLE_WRITE_TOOLS = "1";

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");

      const relPath = "C.md";
      const absPath = path.join(vaultPath, relPath);

      const dryRun = await mcpToolsCall(url, token, sessionId, "new_note", {
        path: relPath,
        text: "hello\n",
        apply: false,
      });
      expect(getStructuredContent(dryRun)["applied"]).toBe(false);
      await expect(fs.stat(absPath)).rejects.toThrow(/ENOENT/);

      const applied = await mcpToolsCall(url, token, sessionId, "new_note", {
        path: relPath,
        text: "hello\n",
        apply: true,
        reindex_after_apply: false,
      });
      expect(getStructuredContent(applied)["applied"]).toBe(true);
      expect(getStructuredContent(applied)["created"]).toBe(true);
      const written = await fs.readFile(absPath, "utf8");
      const parsed = parseMarkdownNote(written);
      expect(typeof parsed.frontmatter.id).toBe("string");
      expect(typeof parsed.frontmatter.created).toBe("string");
      expect(parsed.frontmatter.title).toBe("C");
      expect(Array.isArray(parsed.frontmatter.tags)).toBe(true);
      expect(parsed.frontmatter.tags).not.toContain("inbox");
      expect(parsed.body).toContain("hello");

      const inboxRelPath = "100. Inbox/In.md";
      await mcpToolsCall(url, token, sessionId, "new_note", {
        path: inboxRelPath,
        text: "inbox\n",
        apply: true,
        reindex_after_apply: false,
      });
      const inboxWritten = await fs.readFile(path.join(vaultPath, inboxRelPath), "utf8");
      const inboxParsed = parseMarkdownNote(inboxWritten);
      expect(Array.isArray(inboxParsed.frontmatter.tags)).toBe(true);
      expect(inboxParsed.frontmatter.tags).toContain("inbox");
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("searches the vault via search_vault", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;
    await fs.writeFile(path.join(vaultPath, "Doc.md"), "a\nneedle\nb\n", "utf8");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");
      const res = await mcpToolsCall(url, token, sessionId, "search_vault", {
        query: "needle",
        regex: false,
        case_sensitive: true,
        max_results: 10,
        max_matches_per_file: 10,
      });

      const structured = getStructuredContent(res);
      const results = structured["results"];
      assertArray(results, "results");
      expect(results.length).toBe(1);
      assertRecord(results[0], "results[0]");
      expect(results[0]["path"]).toBe("Doc.md");
      const matches = results[0]["matches"];
      assertArray(matches, "matches");
      expect(matches.length).toBe(1);
      assertRecord(matches[0], "matches[0]");
      expect(matches[0]["line"]).toBe(2);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("returns a vault tree via get_vault_tree", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;

    await fs.mkdir(path.join(vaultPath, "A/B"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, "A/B/C.md"), "c\n", "utf8");
    await fs.writeFile(path.join(vaultPath, "Root.md"), "root\n", "utf8");

    await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, ".obsidian/Hidden.md"), "nope\n", "utf8");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");

      const foldersOnly = await mcpToolsCall(url, token, sessionId, "get_vault_tree", {
        include_files: false,
        max_depth: 10,
        max_nodes: 1000,
      });

      const foldersStructured = getStructuredContent(foldersOnly);
      expect(foldersStructured["file_count"]).toBe(0);
      const folders = foldersStructured["folders"];
      assertArray(folders, "foldersOnly.folders");
      expect(folders).toContain("A");
      expect(folders).toContain("A/B");

      const treeOnly = foldersStructured["tree"];
      assertString(treeOnly, "foldersOnly.tree");
      expect(treeOnly).toContain("A");
      expect(treeOnly).not.toContain(".obsidian");

      const withFiles = await mcpToolsCall(url, token, sessionId, "get_vault_tree", {
        include_files: true,
        max_depth: 10,
        max_nodes: 1000,
      });

      const withFilesStructured = getStructuredContent(withFiles);
      const files = withFilesStructured["files"];
      assertArray(files, "withFiles.files");
      expect(files).toContain("A/B/C.md");
      expect(files).toContain("Root.md");
      expect(files).not.toContain(".obsidian/Hidden.md");
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("returns a typed-link graph via get_vault_graph", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    delete process.env.AILSS_ENABLE_WRITE_TOOLS;

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const now = new Date().toISOString().slice(0, 19);
    const fileStmt = runtime.deps.db.prepare(
      "INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    const noteStmt = runtime.deps.db.prepare(
      "INSERT INTO notes(path, note_id, created, title, summary, entity, layer, status, updated, viewed, frontmatter_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const linkStmt = runtime.deps.db.prepare(
      "INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    fileStmt.run("A.md", 0, 0, "0", now);
    fileStmt.run("B.md", 0, 0, "0", now);

    noteStmt.run(
      "A.md",
      "A",
      now,
      "A",
      null,
      null,
      "conceptual",
      "draft",
      now,
      0,
      JSON.stringify({ id: "A", title: "A", tags: [] }),
      now,
    );
    noteStmt.run(
      "B.md",
      "B",
      now,
      "B",
      null,
      null,
      "conceptual",
      "draft",
      now,
      0,
      JSON.stringify({ id: "B", title: "B", tags: [] }),
      now,
    );

    linkStmt.run("A.md", "see_also", "B", "[[B]]", 0, now);

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");
      const res = await mcpToolsCall(url, token, sessionId, "get_vault_graph", {
        seed_paths: ["A.md"],
        max_hops: 1,
        max_nodes: 10,
        max_edges: 10,
        max_resolutions_per_target: 5,
      });

      const structured = getStructuredContent(res);
      const nodes = structured["nodes"];
      assertArray(nodes, "nodes");
      expect(nodes.map((n) => (n as Record<string, unknown>)["path"]).sort()).toEqual([
        "A.md",
        "B.md",
      ]);

      const edges = structured["edges"];
      assertArray(edges, "edges");
      expect(edges.length).toBe(1);
      assertRecord(edges[0], "edges[0]");
      expect(edges[0]["from_path"]).toBe("A.md");
      expect(edges[0]["to_target"]).toBe("B");

      const toPaths = edges[0]["to_paths"];
      assertArray(toPaths, "edges[0].to_paths");
      expect(toPaths.map((t) => (t as Record<string, unknown>)["path"])).toContain("B.md");
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("captures a note via capture_note (dry-run + apply)", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    process.env.AILSS_ENABLE_WRITE_TOOLS = "1";

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");

      const dryRun = await mcpToolsCall(url, token, sessionId, "capture_note", {
        title: "Hello Capture",
        body: "body\n",
        apply: false,
      });

      const dryStructured = getStructuredContent(dryRun);
      const dryPath = dryStructured["path"];
      assertString(dryPath, "dryRun.path");
      expect(dryPath.startsWith("100. Inbox/")).toBe(true);
      await expect(fs.stat(path.join(vaultPath, dryPath))).rejects.toThrow(/ENOENT/);

      const applied = await mcpToolsCall(url, token, sessionId, "capture_note", {
        title: "Hello Capture",
        body: "body\n",
        apply: true,
        reindex_after_apply: false,
      });

      const appliedStructured = getStructuredContent(applied);
      const appliedPath = appliedStructured["path"];
      assertString(appliedPath, "applied.path");
      expect(appliedPath.startsWith("100. Inbox/")).toBe(true);

      const written = await fs.readFile(path.join(vaultPath, appliedPath), "utf8");
      const parsed = parseMarkdownNote(written);
      expect(parsed.frontmatter.title).toBe("Hello Capture");
      expect(Array.isArray(parsed.frontmatter.tags)).toBe(true);
      expect(parsed.frontmatter.tags).toContain("inbox");
      expect(parsed.body).toContain("body");

      const other = await mcpToolsCall(url, token, sessionId, "capture_note", {
        title: "Outside Inbox",
        body: "body2\n",
        folder: "200. Projects",
        apply: true,
        reindex_after_apply: false,
      });
      const otherStructured = getStructuredContent(other);
      const otherPath = otherStructured["path"];
      assertString(otherPath, "other.path");
      expect(otherPath.startsWith("200. Projects/")).toBe(true);
      const otherWritten = await fs.readFile(path.join(vaultPath, otherPath), "utf8");
      const otherParsed = parseMarkdownNote(otherWritten);
      expect(Array.isArray(otherParsed.frontmatter.tags)).toBe(true);
      expect(otherParsed.frontmatter.tags).not.toContain("inbox");
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });

  it("relocates a note via relocate_note (dry-run + apply)", async () => {
    const dir = await mkTempDir();
    const vaultPath = dir;
    await fs.writeFile(path.join(vaultPath, "From.md"), "from\n", "utf8");

    const saved = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
      AILSS_DB_PATH: process.env.AILSS_DB_PATH,
      AILSS_VAULT_PATH: process.env.AILSS_VAULT_PATH,
      AILSS_ENABLE_WRITE_TOOLS: process.env.AILSS_ENABLE_WRITE_TOOLS,
    };

    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
    delete process.env.AILSS_DB_PATH;
    process.env.AILSS_VAULT_PATH = vaultPath;
    process.env.AILSS_ENABLE_WRITE_TOOLS = "1";

    const runtime = await createAilssMcpRuntimeFromEnv();
    const token = "test-token";

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions: 5,
      idleTtlMs: 60_000,
    });

    try {
      const sessionId = await mcpInitialize(url, token, "client-a");

      const dryRun = await mcpToolsCall(url, token, sessionId, "relocate_note", {
        from_path: "From.md",
        to_path: "To.md",
        apply: false,
      });
      expect(getStructuredContent(dryRun)["applied"]).toBe(false);
      expect(await fs.readFile(path.join(vaultPath, "From.md"), "utf8")).toBe("from\n");
      await expect(fs.stat(path.join(vaultPath, "To.md"))).rejects.toThrow(/ENOENT/);

      const applied = await mcpToolsCall(url, token, sessionId, "relocate_note", {
        from_path: "From.md",
        to_path: "To.md",
        apply: true,
        reindex_after_apply: false,
      });
      expect(getStructuredContent(applied)["applied"]).toBe(true);
      expect(getStructuredContent(applied)["updated_applied"]).toBe(false);
      expect(getStructuredContent(applied)["updated_value"]).toBe(null);
      await expect(fs.stat(path.join(vaultPath, "From.md"))).rejects.toThrow(/ENOENT/);
      expect(await fs.readFile(path.join(vaultPath, "To.md"), "utf8")).toBe("from\n");

      await mcpToolsCall(url, token, sessionId, "new_note", {
        path: "WithFrontmatter.md",
        text: "x\n",
        apply: true,
        reindex_after_apply: false,
      });
      const relocated = await mcpToolsCall(url, token, sessionId, "relocate_note", {
        from_path: "WithFrontmatter.md",
        to_path: "WithFrontmatterMoved.md",
        apply: true,
        reindex_after_apply: false,
      });
      const relocatedStructured = getStructuredContent(relocated);
      expect(relocatedStructured["updated_applied"]).toBe(true);
      const updatedValue = relocatedStructured["updated_value"];
      assertString(updatedValue, "relocate_note.updated_value");
      const movedText = await fs.readFile(path.join(vaultPath, "WithFrontmatterMoved.md"), "utf8");
      const movedParsed = parseMarkdownNote(movedText);
      expect(movedParsed.frontmatter.updated).toBe(updatedValue);
    } finally {
      await close();
      runtime.deps.db.close();

      process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
      process.env.OPENAI_EMBEDDING_MODEL = saved.OPENAI_EMBEDDING_MODEL;
      if (saved.AILSS_DB_PATH === undefined) delete process.env.AILSS_DB_PATH;
      else process.env.AILSS_DB_PATH = saved.AILSS_DB_PATH;
      if (saved.AILSS_VAULT_PATH === undefined) delete process.env.AILSS_VAULT_PATH;
      else process.env.AILSS_VAULT_PATH = saved.AILSS_VAULT_PATH;
      if (saved.AILSS_ENABLE_WRITE_TOOLS === undefined) delete process.env.AILSS_ENABLE_WRITE_TOOLS;
      else process.env.AILSS_ENABLE_WRITE_TOOLS = saved.AILSS_ENABLE_WRITE_TOOLS;
    }
  });
});
