import { afterEach, describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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
});
