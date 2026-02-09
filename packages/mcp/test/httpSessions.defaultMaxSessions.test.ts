import { describe, it } from "vitest";

import path from "node:path";

import { createAilssMcpRuntimeFromEnv } from "../src/createAilssMcpServer.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import {
  mcpInitialize,
  mcpToolsList,
  mcpToolsListExpectSessionNotFound,
  withEnv,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (default max sessions)", () => {
  it("uses 50 as the default max session cap when env override is missing", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withEnv(
        {
          OPENAI_API_KEY: "test",
          OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
          AILSS_DB_PATH: dbPath,
          AILSS_VAULT_PATH: "",
          AILSS_ENABLE_WRITE_TOOLS: "",
          AILSS_MCP_HTTP_MAX_SESSIONS: "",
        },
        async () => {
          const runtime = await createAilssMcpRuntimeFromEnv();
          const token = "test-token";
          const { close, url } = await startAilssMcpHttpServer({
            runtime,
            config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
            idleTtlMs: 60_000,
          });

          try {
            const sessions: string[] = [];

            for (let i = 0; i < 21; i++) {
              sessions.push(await mcpInitialize(url, token, `client-${i}`));
            }

            await mcpToolsList(url, token, sessions[0]!);
            await mcpToolsList(url, token, sessions[20]!);

            for (let i = 21; i < 51; i++) {
              sessions.push(await mcpInitialize(url, token, `client-${i}`));
            }

            await mcpToolsListExpectSessionNotFound(url, token, sessions[1]!);
            await mcpToolsList(url, token, sessions[50]!);
          } finally {
            await close();
            runtime.deps.db.close();
          }
        },
      );
    });
  });
});
