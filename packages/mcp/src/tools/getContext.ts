// get_context tool
// - semantic search + stitched evidence (multi-chunk + neighbors)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpToolDeps } from "../mcpDeps.js";
import { handleGetContextCall } from "../lib/getContext/handler.js";
import {
  buildGetContextInputSchema,
  buildGetContextOutputSchema,
} from "../lib/getContext/schema.js";

export function registerGetContextTool(server: McpServer, deps: McpToolDeps): void {
  const defaultTopK = parseDefaultTopKFromEnv(process.env.AILSS_GET_CONTEXT_DEFAULT_TOP_K);

  server.registerTool(
    "get_context",
    {
      title: "Get context",
      description:
        "Builds a context set for a query: semantic search over indexed chunks, then returns the top matching notes with note metadata and stitched evidence chunks (optionally with file-start previews).",
      inputSchema: buildGetContextInputSchema(defaultTopK),
      outputSchema: buildGetContextOutputSchema(),
    },
    async (args) => handleGetContextCall(deps, args),
  );
}

function parseDefaultTopKFromEnv(raw: string | undefined): number {
  const defaultTopK = 10;
  if (!raw) return defaultTopK;
  const trimmed = raw.trim();
  if (!trimmed) return defaultTopK;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return defaultTopK;

  const n = Math.floor(parsed);
  if (n < 1) return 1;
  if (n > 50) return 50;
  return n;
}
