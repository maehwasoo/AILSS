// resolve_note tool
// - DB-backed note path resolution for id/title/wikilink targets

import { normalizeTypedLinkTargetInput, resolveNotePathsByWikilinkTarget } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerResolveNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "resolve_note",
    {
      title: "Resolve note",
      description: [
        "Resolves an id/title/wikilink target to indexed note path candidates using the local SQLite DB.",
        "Intended to be used before calling path-based tools like read_note/edit_note.",
        "DB-only: does not read note bodies and works without AILSS_VAULT_PATH.",
      ].join(" "),
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Raw target (id/title/wikilink), e.g. "20260108123456", "Project A", or "[[WorldAce]]"',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("Maximum number of candidate paths returned (1–200)"),
      },
      outputSchema: z.object({
        query: z.object({
          raw: z.string(),
          normalized_target: z.string(),
          limit: z.number().int(),
        }),
        status: z.union([z.literal("ok"), z.literal("ambiguous"), z.literal("not_found")]),
        best: z
          .object({
            path: z.string(),
            title: z.string().nullable(),
            matched_by: z.union([z.literal("path"), z.literal("note_id"), z.literal("title")]),
          })
          .nullable(),
        candidates: z.array(
          z.object({
            path: z.string(),
            title: z.string().nullable(),
            matched_by: z.union([z.literal("path"), z.literal("note_id"), z.literal("title")]),
          }),
        ),
      }),
    },
    async (args) => {
      const normalizedTarget = normalizeTypedLinkTargetInput(args.query);
      if (!normalizedTarget) {
        throw new Error(`Cannot resolve an empty target: query="${args.query}"`);
      }

      const candidates = resolveNotePathsByWikilinkTarget(deps.db, normalizedTarget, args.limit);

      const status =
        candidates.length === 0 ? "not_found" : candidates.length === 1 ? "ok" : "ambiguous";
      const best = candidates[0];

      const payload = {
        query: { raw: args.query, normalized_target: normalizedTarget, limit: args.limit },
        status,
        best: best ? { path: best.path, title: best.title, matched_by: best.matchedBy } : null,
        candidates: candidates.map((c) => ({
          path: c.path,
          title: c.title,
          matched_by: c.matchedBy,
        })),
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
