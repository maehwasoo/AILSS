#!/usr/bin/env node
// AILSS MCP server - STDIO transport
// - Prometheus Agent instructions + tool surface

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAilssMcpServer } from "./createAilssMcpServer.js";

async function main(): Promise<void> {
  const { server } = await createAilssMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
