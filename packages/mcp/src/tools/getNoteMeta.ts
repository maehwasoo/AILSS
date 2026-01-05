// get_note_meta tool
// - DB-backed note metadata (frontmatter + typed links)

import { getNoteMeta } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerGetNoteMetaTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_note_meta",
    {
      title: "Get note metadata",
      description:
        "Returns indexed note metadata (frontmatter-derived fields + typed links). Requires indexing; does not read vault files.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path (must exist in the index DB)"),
      },
      outputSchema: z.object({
        path: z.string(),
        noteId: z.string().nullable(),
        created: z.string().nullable(),
        title: z.string().nullable(),
        summary: z.string().nullable(),
        entity: z.string().nullable(),
        layer: z.string().nullable(),
        status: z.string().nullable(),
        updated: z.string().nullable(),
        viewed: z.number().nullable(),
        tags: z.array(z.string()),
        keywords: z.array(z.string()),
        frontmatter: z.record(z.any()),
        typedLinks: z.array(
          z.object({
            rel: z.string(),
            toTarget: z.string(),
            toWikilink: z.string(),
            position: z.number().int(),
          }),
        ),
      }),
    },
    async (args) => {
      const meta = getNoteMeta(deps.db, args.path);
      if (!meta) {
        throw new Error(
          `Note metadata not found for path="${args.path}". Re-run the indexer to populate frontmatter/typed links.`,
        );
      }

      return {
        structuredContent: meta,
        content: [{ type: "text", text: JSON.stringify(meta, null, 2) }],
      };
    },
  );
}
