// list_keywords tool
// - DB-backed keyword facet listing

import { listKeywords } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerListKeywordsTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "list_keywords",
    {
      title: "List keywords",
      description:
        "Lists all indexed keywords (frontmatter.keywords) with usage counts, from the local SQLite DB.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(200)
          .describe("Maximum number of keywords returned (1–5000)"),
      },
      outputSchema: z.object({
        keywords: z.array(
          z.object({
            keyword: z.string(),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
    },
    async (args) => {
      const keywords = listKeywords(deps.db, { limit: args.limit });
      const payload = { keywords };
      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
