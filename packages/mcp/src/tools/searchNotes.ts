// search_notes tool
// - DB-backed note metadata filtering (no embeddings)

import { searchNotes } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

const StringOrStringArray = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export function registerSearchNotesTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Searches indexed note metadata (frontmatter-derived fields, tags/keywords/sources) in the local SQLite DB. Does not read note bodies and does not call embeddings APIs.",
      inputSchema: {
        path_prefix: z.string().min(1).optional().describe("Optional vault-relative path prefix"),
        title_query: z
          .string()
          .min(1)
          .optional()
          .describe('Substring match against notes.title (SQL LIKE, e.g. "Project")'),

        note_id: StringOrStringArray.optional().describe(
          "Filter by frontmatter id (notes.note_id)",
        ),
        entity: StringOrStringArray.optional().describe("Filter by notes.entity"),
        layer: StringOrStringArray.optional().describe("Filter by notes.layer"),
        status: StringOrStringArray.optional().describe("Filter by notes.status"),

        created_from: z
          .string()
          .min(1)
          .optional()
          .describe('Lower bound for notes.created (expected ISO like "2026-01-08T12:34:56")'),
        created_to: z
          .string()
          .min(1)
          .optional()
          .describe('Upper bound for notes.created (expected ISO like "2026-01-08T12:34:56")'),
        updated_from: z
          .string()
          .min(1)
          .optional()
          .describe('Lower bound for notes.updated (expected ISO like "2026-01-08T12:34:56")'),
        updated_to: z
          .string()
          .min(1)
          .optional()
          .describe('Upper bound for notes.updated (expected ISO like "2026-01-08T12:34:56")'),

        tags_any: z
          .array(z.string().min(1))
          .default([])
          .describe("Match notes that have ANY of these tags"),
        tags_all: z
          .array(z.string().min(1))
          .default([])
          .describe("Match notes that have ALL of these tags"),
        keywords_any: z
          .array(z.string().min(1))
          .default([])
          .describe("Match notes that have ANY of these keywords"),
        sources_any: z
          .array(z.string().min(1))
          .default([])
          .describe("Match notes that have ANY of these sources (frontmatter source: [])"),

        order_by: z
          .enum(["path", "created", "updated"])
          .default("path")
          .describe("Sort key for results"),
        order_dir: z.enum(["asc", "desc"]).default("asc").describe("Sort direction"),

        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum number of notes returned (1–500)"),
      },
      outputSchema: z.object({
        filters: z.record(z.string(), z.unknown()),
        results: z.array(
          z.object({
            path: z.string(),
            note_id: z.string().nullable(),
            created: z.string().nullable(),
            title: z.string().nullable(),
            summary: z.string().nullable(),
            entity: z.string().nullable(),
            layer: z.string().nullable(),
            status: z.string().nullable(),
            updated: z.string().nullable(),
            tags: z.array(z.string()),
            keywords: z.array(z.string()),
            sources: z.array(z.string()),
          }),
        ),
      }),
    },
    async (args) => {
      const filters: Parameters<typeof searchNotes>[1] = {
        tagsAny: args.tags_any,
        tagsAll: args.tags_all,
        keywordsAny: args.keywords_any,
        sourcesAny: args.sources_any,
        orderBy: args.order_by,
        orderDir: args.order_dir,
        limit: args.limit,
      };

      if (args.path_prefix) filters.pathPrefix = args.path_prefix;
      if (args.title_query) filters.titleQuery = args.title_query;
      if (args.note_id) filters.noteId = args.note_id;
      if (args.entity) filters.entity = args.entity;
      if (args.layer) filters.layer = args.layer;
      if (args.status) filters.status = args.status;
      if (args.created_from) filters.createdFrom = args.created_from;
      if (args.created_to) filters.createdTo = args.created_to;
      if (args.updated_from) filters.updatedFrom = args.updated_from;
      if (args.updated_to) filters.updatedTo = args.updated_to;

      const results = searchNotes(deps.db, filters);

      const payload = {
        filters: args,
        results: results.map((r) => ({
          path: r.path,
          note_id: r.noteId,
          created: r.created,
          title: r.title,
          summary: r.summary,
          entity: r.entity,
          layer: r.layer,
          status: r.status,
          updated: r.updated,
          tags: r.tags,
          keywords: r.keywords,
          sources: r.sources,
        })),
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
