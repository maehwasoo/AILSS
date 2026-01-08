#!/usr/bin/env node
// AILSS MCP server - Streamable HTTP transport (localhost)
// - Intended to be hosted by the Obsidian plugin and consumed by Codex via URL + token.

import { startAilssMcpHttpServerFromEnv } from "./httpServer.js";

async function main(): Promise<void> {
  const { httpServer, url } = await startAilssMcpHttpServerFromEnv();
  console.log(`[ailss-mcp-http] listening on ${url}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[ailss-mcp-http] shutdown requested (${signal})`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
