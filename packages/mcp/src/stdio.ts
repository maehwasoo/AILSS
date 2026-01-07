#!/usr/bin/env node
// AILSS MCP server - STDIO transport
// - Prometheus Agent instructions + tool surface

import OpenAI from "openai";

import { loadEnv, openAilssDb, resolveDefaultDbPath } from "@ailss/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { embeddingDimForModel } from "./lib/openaiEmbeddings.js";
import { PROMETHEUS_AGENT_INSTRUCTIONS, registerPrometheusPrompt } from "./prometheus.js";
import type { McpToolDeps } from "./mcpDeps.js";
import { registerActivateContextTool } from "./tools/activateContext.js";
import { registerFindNotesByTypedLinkTool } from "./tools/findNotesByTypedLink.js";
import { registerEditNoteTool } from "./tools/editNote.js";
import { registerGetNoteTool } from "./tools/getNote.js";
import { registerGetNoteMetaTool } from "./tools/getNoteMeta.js";
import { registerSearchNotesTool } from "./tools/searchNotes.js";
import { registerSemanticSearchTool } from "./tools/semanticSearch.js";

async function main(): Promise<void> {
  const env = loadEnv();

  const embeddingModel = env.openaiEmbeddingModel;
  const embeddingDim = embeddingDimForModel(embeddingModel);

  const vaultPath = env.vaultPath;
  const dbPath =
    process.env.AILSS_DB_PATH ?? (vaultPath ? await resolveDefaultDbPath(vaultPath) : undefined);
  if (!dbPath) {
    throw new Error("DB path is missing. Set AILSS_VAULT_PATH or AILSS_DB_PATH.");
  }

  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Set it via .env or environment variables.");
  }

  const db = openAilssDb({ dbPath, embeddingModel, embeddingDim, mode: "readonly" });
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const server = new McpServer(
    { name: "ailss-mcp", version: "0.1.0" },
    { instructions: PROMETHEUS_AGENT_INSTRUCTIONS },
  );

  registerPrometheusPrompt(server);

  const deps: McpToolDeps = {
    db,
    dbPath,
    vaultPath,
    openai,
    embeddingModel,
  };

  registerSemanticSearchTool(server, deps);
  registerActivateContextTool(server, deps);
  registerGetNoteTool(server, deps);
  registerGetNoteMetaTool(server, deps);
  registerSearchNotesTool(server, deps);
  registerFindNotesByTypedLinkTool(server, deps);

  if (env.enableWriteTools) {
    registerEditNoteTool(server, deps);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
