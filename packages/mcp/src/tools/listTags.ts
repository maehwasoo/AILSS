// list_tags tool
// - DB-backed tag facet listing

import { listTags } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerListTagsTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "Lists all indexed tags (frontmatter.tags) with usage counts, from the local SQLite DB.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(200)
          .describe("Maximum number of tags returned (1–5000)"),
      },
      outputSchema: z.object({
        tags: z.array(
          z.object({
            tag: z.string(),
            count: z.number().int().nonnegative(),
          }),
        ),
      }),
    },
    async (args) => {
      const tags = listTags(deps.db, { limit: args.limit });
      const payload = { tags };
      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
