// list_typed_link_rels tool
// - DB-backed typed-link relation facet listing

import { AILSS_TYPED_LINK_KEYS, listTypedLinkRels } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

const ORDER_BY_OPTIONS = ["count_desc", "rel_asc"] as const;

export function registerListTypedLinkRelsTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "list_typed_link_rels",
    {
      title: "List typed-link relations",
      description:
        "Lists typed-link relation keys (`rel`) with usage counts from the local SQLite DB, including canonical/non-canonical classification.",
      inputSchema: {
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only count links from notes under this vault-relative path prefix"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(200)
          .describe("Maximum number of relation rows returned (1–5000)"),
        order_by: z
          .enum(ORDER_BY_OPTIONS)
          .default("count_desc")
          .describe("Sort order: count_desc (default) or rel_asc"),
      },
      outputSchema: z.object({
        query: z.object({
          path_prefix: z.string().nullable(),
          limit: z.number().int(),
          order_by: z.enum(ORDER_BY_OPTIONS),
        }),
        rels: z.array(
          z.object({
            rel: z.string(),
            count: z.number().int().nonnegative(),
            canonical: z.boolean(),
          }),
        ),
      }),
    },
    async (args) => {
      const canonicalRels = new Set<string>(AILSS_TYPED_LINK_KEYS);
      const rows = listTypedLinkRels(deps.db, {
        ...(args.path_prefix ? { pathPrefix: args.path_prefix } : {}),
        limit: args.limit,
        orderBy: args.order_by,
      });

      const payload = {
        query: {
          path_prefix: args.path_prefix ?? null,
          limit: args.limit,
          order_by: args.order_by,
        },
        rels: rows.map((row) => ({
          rel: row.rel,
          count: row.count,
          canonical: canonicalRels.has(row.rel),
        })),
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
