// semantic_search tool

import { semanticSearch } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { embedQuery } from "../lib/openaiEmbeddings.js";

export function registerSemanticSearchTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "semantic_search",
    {
      title: "Semantic search",
      description:
        "Vector similarity search over indexed chunks (SQLite + sqlite-vec). Uses OpenAI embeddings for the query.",
      inputSchema: {
        query: z.string().min(1).describe("Search query text"),
        top_k: z.number().int().min(1).max(50).default(10).describe("Number of results to return"),
      },
      outputSchema: z.object({
        query: z.string(),
        top_k: z.number().int(),
        db: z.string(),
        results: z.array(
          z.object({
            path: z.string(),
            heading: z.string().nullable(),
            heading_path: z.array(z.string()),
            distance: z.number(),
            snippet: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const queryEmbedding = await embedQuery(deps.openai, deps.embeddingModel, args.query);
      const results = semanticSearch(deps.db, queryEmbedding, args.top_k);

      const payload = {
        query: args.query,
        top_k: args.top_k,
        db: deps.dbPath,
        results: results.map((r) => ({
          path: r.path,
          heading: r.heading,
          heading_path: r.headingPath,
          distance: r.distance,
          snippet: r.content.slice(0, 300),
        })),
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
