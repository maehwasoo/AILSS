import OpenAI from "openai";

import { loadEnv, openAilssDb, resolveDefaultDbPath } from "@ailss/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AsyncMutex } from "./lib/asyncMutex.js";
import { embeddingDimForModel } from "./lib/openaiEmbeddings.js";
import { createMcpToolFailureDiagnostics } from "./lib/toolFailureDiagnostics.js";
import type { McpToolDeps } from "./mcpDeps.js";
import { registerCaptureNoteTool } from "./tools/captureNote.js";
import { registerCanonicalizeTypedLinksTool } from "./tools/canonicalizeTypedLinks.js";
import { registerEditNoteTool } from "./tools/editNote.js";
import { registerExpandTypedLinksOutgoingTool } from "./tools/expandTypedLinksOutgoing.js";
import { registerFindBrokenLinksTool } from "./tools/findBrokenLinks.js";
import { registerFindTypedLinksIncomingTool } from "./tools/findTypedLinksIncoming.js";
import { registerFrontmatterValidateTool } from "./tools/frontmatterValidate.js";
import { registerGetContextTool } from "./tools/getContext.js";
import { registerGetNoteTool } from "./tools/getNote.js";
import { registerGetToolFailureReportTool } from "./tools/getToolFailureReport.js";
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

type ToolCallbackExtra = {
  requestId?: unknown;
  sessionId?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolCallbackExtra(value: unknown): value is ToolCallbackExtra {
  return isRecord(value) && "requestId" in value;
}

function splitToolCallbackArgs(args: unknown[]): {
  toolArgs: unknown;
  extra: ToolCallbackExtra | undefined;
} {
  if (args.length === 0) {
    return { toolArgs: undefined, extra: undefined };
  }

  if (args.length === 1) {
    const first = args[0];
    if (isToolCallbackExtra(first)) return { toolArgs: undefined, extra: first };
    return { toolArgs: first, extra: undefined };
  }

  const second = args[1];
  return {
    toolArgs: args[0],
    extra: isToolCallbackExtra(second) ? second : undefined,
  };
}

function installToolFailureDiagnostics(server: McpServer, deps: McpToolDeps): void {
  const diagnostics = deps.toolFailureDiagnostics;
  if (!diagnostics?.enabled) return;

  type UntypedRegisterTool = (
    name: string,
    config: unknown,
    cb: (...args: unknown[]) => unknown,
  ) => unknown;

  const originalRegisterTool = server.registerTool.bind(server) as unknown as UntypedRegisterTool;
  const wrappedRegisterTool = ((
    name: string,
    config: unknown,
    cb: (...args: unknown[]) => unknown,
  ) =>
    originalRegisterTool(name, config, async (...toolCallbackArgs: unknown[]) => {
      const { toolArgs, extra } = splitToolCallbackArgs(toolCallbackArgs);

      try {
        return await cb(...toolCallbackArgs);
      } catch (error) {
        await diagnostics.logToolFailure({
          tool: name,
          operation: "tool_call",
          args: toolArgs,
          error,
          requestId: extra?.requestId,
          sessionId: extra?.sessionId,
        });
        throw error;
      }
    })) as McpServer["registerTool"];

  server.registerTool = wrappedRegisterTool;
}

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
      toolFailureDiagnostics: createMcpToolFailureDiagnostics({
        vaultPath,
        cwd: process.cwd(),
      }),
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
  installToolFailureDiagnostics(server, deps);

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
  registerGetToolFailureReportTool(server, deps);

  if (runtime.enableWriteTools) {
    registerCaptureNoteTool(server, deps);
    registerCanonicalizeTypedLinksTool(server, deps);
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
