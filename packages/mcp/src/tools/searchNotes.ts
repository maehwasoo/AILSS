// search_notes tool
// - DB-backed structured filtering

import { searchNotes } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerSearchNotesTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "search_notes",
    {
      title: "Search notes (metadata)",
      description:
        "Filters indexed notes by frontmatter-derived fields (entity/layer/status) plus tags/keywords and path/title filters. Does not use embeddings.",
      inputSchema: {
        path_prefix: z.string().min(1).optional().describe("Filter by vault-relative path prefix"),
        title_query: z.string().min(1).optional().describe("Substring match against title"),
        entity: z.string().min(1).optional().describe("Exact entity match (frontmatter-derived)"),
        layer: z.string().min(1).optional().describe("Exact layer match (frontmatter-derived)"),
        status: z.string().min(1).optional().describe("Exact status match (frontmatter-derived)"),
        tags_any: z.array(z.string().min(1)).optional().describe("Match any of these tags"),
        tags_all: z.array(z.string().min(1)).optional().describe("Must include all of these tags"),
        keywords_any: z.array(z.string().min(1)).optional().describe("Match any of these keywords"),
        limit: z.number().int().min(1).max(500).default(50).describe("Maximum results to return"),
      },
      outputSchema: z.object({
        filters: z.record(z.any()),
        db: z.string(),
        results: z.array(
          z.object({
            path: z.string(),
            title: z.string().nullable(),
            entity: z.string().nullable(),
            layer: z.string().nullable(),
            status: z.string().nullable(),
          }),
        ),
      }),
    },
    async (args) => {
      const results = searchNotes(deps.db, {
        limit: args.limit,
        ...(args.path_prefix ? { pathPrefix: args.path_prefix } : {}),
        ...(args.title_query ? { titleQuery: args.title_query } : {}),
        ...(args.entity ? { entity: args.entity } : {}),
        ...(args.layer ? { layer: args.layer } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.tags_any ? { tagsAny: args.tags_any } : {}),
        ...(args.tags_all ? { tagsAll: args.tags_all } : {}),
        ...(args.keywords_any ? { keywordsAny: args.keywords_any } : {}),
      });

      const payload = { filters: args as Record<string, unknown>, db: deps.dbPath, results };
      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
