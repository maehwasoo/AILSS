// find_typed_links_incoming tool
// - DB-backed typed-link backref queries (incoming edges)

import { AILSS_TYPED_LINK_KEYS, findNotesByTypedLink } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerFindTypedLinksIncomingTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "find_typed_links_incoming",
    {
      title: "Find typed links incoming",
      description:
        "Finds notes that reference a target via typed links. This is an incoming-edge query over the typed_links table.",
      inputSchema: {
        rel: z.string().min(1).optional().describe("Relation key to match (e.g. part_of, cites)"),
        to_target: z
          .string()
          .min(1)
          .optional()
          .describe('Normalized wikilink target (e.g. "WorldAce")'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(100)
          .describe("Maximum number of backrefs returned (1–1000)"),
        canonical_only: z
          .boolean()
          .default(true)
          .describe(
            "When true, restrict results to canonical frontmatter typed-link keys only (filters out legacy/non-canonical relations).",
          ),
      },
      outputSchema: z.object({
        query: z.object({
          rel: z.string().nullable(),
          to_target: z.string().nullable(),
          limit: z.number().int(),
          canonical_only: z.boolean(),
        }),
        backrefs: z.array(
          z.object({
            from_path: z.string(),
            from_title: z.string().nullable(),
            rel: z.string(),
            to_target: z.string(),
            to_wikilink: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const query: Parameters<typeof findNotesByTypedLink>[1] = { limit: args.limit };
      if (args.canonical_only) query.rels = [...AILSS_TYPED_LINK_KEYS];
      if (args.rel) query.rel = args.rel;
      if (args.to_target) query.toTarget = args.to_target;

      const backrefs = findNotesByTypedLink(deps.db, query);

      const payload = {
        query: {
          rel: args.rel ?? null,
          to_target: args.to_target ?? null,
          limit: args.limit,
          canonical_only: args.canonical_only,
        },
        backrefs: backrefs.map((b) => ({
          from_path: b.fromPath,
          from_title: b.fromTitle,
          rel: b.rel,
          to_target: b.toTarget,
          to_wikilink: b.toWikilink,
        })),
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
