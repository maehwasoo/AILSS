import { describe, expect, it } from "vitest";

import { PassThrough } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  createAilssMcpRuntimeFromEnv,
  createAilssMcpServerFromRuntime,
} from "../src/createAilssMcpServer.js";

import { withEnv, withTempDir } from "./httpTestUtils.js";

const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: unknown;
};

async function withMcpStdioServer<T>(
  options: { vaultPath: string; enableWriteTools?: boolean },
  fn: (ctx: {
    send: (msg: unknown) => void;
    request: (msg: unknown) => Promise<JsonRpcResponse>;
  }) => Promise<T>,
): Promise<T> {
  return await withEnv(
    {
      OPENAI_API_KEY: "test",
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
      AILSS_DB_PATH: "",
      AILSS_VAULT_PATH: options.vaultPath,
      AILSS_ENABLE_WRITE_TOOLS: options.enableWriteTools ? "1" : "",
    },
    async () => {
      const runtime = await createAilssMcpRuntimeFromEnv();
      const { server } = createAilssMcpServerFromRuntime(runtime);

      const clientToServer = new PassThrough();
      const serverToClient = new PassThrough();

      const transport = new StdioServerTransport(clientToServer, serverToClient);
      await server.connect(transport);

      const buffer = new ReadBuffer();
      const pending = new Map<number, (res: JsonRpcResponse) => void>();
      let nextId = 1;

      serverToClient.on("data", (chunk: Buffer) => {
        buffer.append(chunk);
        while (true) {
          const msg = buffer.readMessage();
          if (!msg) break;
          const m = msg as unknown as Partial<JsonRpcResponse>;
          if (typeof m.id !== "number") continue;
          const resolve = pending.get(m.id);
          if (!resolve) continue;
          pending.delete(m.id);
          resolve(m as JsonRpcResponse);
        }
      });

      const send = (msg: unknown) => {
        clientToServer.write(serializeMessage(msg as never));
      };

      const request = async (msg: unknown): Promise<JsonRpcResponse> => {
        const id = nextId++;
        const withId =
          typeof msg === "object" && msg !== null && !Array.isArray(msg)
            ? { ...(msg as Record<string, unknown>), id }
            : msg;
        return await new Promise((resolve) => {
          pending.set(id, resolve);
          send(withId);
        });
      };

      try {
        return await fn({ send, request });
      } finally {
        try {
          await transport.close();
        } finally {
          await server.close();
          runtime.deps.db.close();
          clientToServer.end();
          serverToClient.end();
        }
      }
    },
  );
}

describe("MCP STDIO transport", () => {
  it("handles initialize -> tools/list -> tools/call (read_note)", async () => {
    await withTempDir("ailss-mcp-stdio-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(vaultPath, { recursive: true });
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "a\nb\n", "utf8");

      await withMcpStdioServer(
        { vaultPath, enableWriteTools: false },
        async ({ send, request }) => {
          const init = await request({
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "client", version: "0" },
            },
          });
          expect(init.error).toBeUndefined();

          send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

          const list = await request({ jsonrpc: "2.0", method: "tools/list", params: {} });
          expect(list.error).toBeUndefined();

          const listResult = (list.result ?? {}) as Record<string, unknown>;
          const tools = listResult["tools"] as Array<Record<string, unknown>>;
          expect(Array.isArray(tools)).toBe(true);
          expect(tools.map((t) => t.name)).toContain("read_note");

          const call = await request({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: "read_note", arguments: { path: "Doc.md", max_chars: 20_000 } },
          });
          expect(call.error).toBeUndefined();

          const callResult = (call.result ?? {}) as Record<string, unknown>;
          const structured = (callResult["structuredContent"] ?? {}) as Record<string, unknown>;
          expect(structured["path"]).toBe("Doc.md");
          expect(structured["truncated"]).toBe(false);
          expect(structured["content"]).toBe("a\nb\n");
        },
      );
    });
  });
});
