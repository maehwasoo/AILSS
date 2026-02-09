import OpenAI from "openai";

import { loadEnv, openAilssDb, resolveDefaultDbPath } from "@ailss/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AsyncMutex } from "./lib/asyncMutex.js";
import { embeddingDimForModel } from "./lib/openaiEmbeddings.js";
import type { McpToolDeps } from "./mcpDeps.js";
import { registerCaptureNoteTool } from "./tools/captureNote.js";
import { registerEditNoteTool } from "./tools/editNote.js";
import { registerExpandTypedLinksOutgoingTool } from "./tools/expandTypedLinksOutgoing.js";
import { registerFindBrokenLinksTool } from "./tools/findBrokenLinks.js";
import { registerFindTypedLinksIncomingTool } from "./tools/findTypedLinksIncoming.js";
import { registerFrontmatterValidateTool } from "./tools/frontmatterValidate.js";
import { registerGetContextTool } from "./tools/getContext.js";
import { registerGetNoteTool } from "./tools/getNote.js";
import { registerGetVaultTreeTool } from "./tools/getVaultTree.js";
import { registerImproveFrontmatterTool } from "./tools/improveFrontmatter.js";
import { registerListKeywordsTool } from "./tools/listKeywords.js";
import { registerListTagsTool } from "./tools/listTags.js";
import { registerRelocateNoteTool } from "./tools/relocateNote.js";
import { registerResolveNoteTool } from "./tools/resolveNote.js";
import { registerSearchNotesTool } from "./tools/searchNotes.js";

export type AilssMcpRuntime = {
  deps: McpToolDeps;
  enableWriteTools: boolean;
};

export async function createAilssMcpRuntimeFromEnv(): Promise<AilssMcpRuntime> {
  const env = loadEnv();

  const embeddingModel = env.openaiEmbeddingModel;
  const embeddingDim = embeddingDimForModel(embeddingModel);

  const vaultPath = env.vaultPath;
  const dbPath = vaultPath ? await resolveDefaultDbPath(vaultPath) : process.env.AILSS_DB_PATH;
  if (!dbPath) {
    throw new Error("DB path is missing. Set AILSS_VAULT_PATH or AILSS_DB_PATH.");
  }

  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Set it via .env or environment variables.");
  }

  const db = openAilssDb({ dbPath, embeddingModel, embeddingDim });
  const openai = new OpenAI({ apiKey: openaiApiKey });

  return {
    deps: {
      db,
      dbPath,
      vaultPath,
      openai,
      embeddingModel,
      writeLock: new AsyncMutex(),
    },
    enableWriteTools: env.enableWriteTools,
  };
}

export function createAilssMcpServerFromRuntime(runtime: AilssMcpRuntime): {
  server: McpServer;
  deps: McpToolDeps;
} {
  const deps = runtime.deps;

  const server = new McpServer({ name: "ailss-mcp", version: "0.1.0" });

  registerGetContextTool(server, deps);
  registerExpandTypedLinksOutgoingTool(server, deps);
  registerResolveNoteTool(server, deps);
  registerGetNoteTool(server, deps);
  registerGetVaultTreeTool(server, deps);
  registerFrontmatterValidateTool(server, deps);
  registerFindBrokenLinksTool(server, deps);
  registerSearchNotesTool(server, deps);
  registerListTagsTool(server, deps);
  registerListKeywordsTool(server, deps);
  registerFindTypedLinksIncomingTool(server, deps);

  if (runtime.enableWriteTools) {
    registerCaptureNoteTool(server, deps);
    registerEditNoteTool(server, deps);
    registerImproveFrontmatterTool(server, deps);
    registerRelocateNoteTool(server, deps);
  }

  return { server, deps };
}

export async function createAilssMcpServer(): Promise<{
  server: McpServer;
  deps: McpToolDeps;
}> {
  const runtime = await createAilssMcpRuntimeFromEnv();
  return createAilssMcpServerFromRuntime(runtime);
}
