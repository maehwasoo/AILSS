// find_notes_by_typed_link tool
// - DB-backed typed-link backrefs

import { findNotesByTypedLink, normalizeTypedLinkTargetInput } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerFindNotesByTypedLinkTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "find_notes_by_typed_link",
    {
      title: "Find typed-link backrefs",
      description:
        "DB query for typed-link backrefs: returns which notes have a frontmatter typed link that points to a target. Filter by `rel` (e.g. depends_on) and/or `target` (string or [[wikilink]]; normalized). This is not a path-based graph expansion; for graph-shaped results starting from a note path, use get_note_graph/get_vault_graph.",
      inputSchema: {
        rel: z
          .string()
          .min(1)
          .optional()
          .describe("Typed link relation key (e.g. part_of, depends_on). Omit to match any rel."),
        target: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Target string to search for (raw text or [[wikilink]]; normalized before query). Example: target='[[Vite]]' matches depends_on: [[Vite]].",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(200)
          .describe("Maximum backrefs to return (1–1000)"),
      },
      outputSchema: z.object({
        query: z.object({
          rel: z.string().optional(),
          target: z.string().optional(),
          normalized_target: z.string().optional(),
          limit: z.number().int(),
        }),
        db: z.string(),
        results: z.array(
          z.object({
            fromPath: z.string(),
            fromTitle: z.string().nullable(),
            rel: z.string(),
            toTarget: z.string(),
            toWikilink: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const normalizedTarget = args.target ? normalizeTypedLinkTargetInput(args.target) : undefined;

      const results = findNotesByTypedLink(deps.db, {
        limit: args.limit,
        ...(args.rel ? { rel: args.rel } : {}),
        ...(normalizedTarget ? { toTarget: normalizedTarget } : {}),
      });

      const payload = {
        query: {
          rel: args.rel,
          target: args.target,
          normalized_target: normalizedTarget,
          limit: args.limit,
        },
        db: deps.dbPath,
        results,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
