// find_broken_links tool
// - detects unresolved wikilinks / typed links using the index DB

import { AILSS_TYPED_LINK_KEYS, resolveNotePathsByWikilinkTarget } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

const DEFAULT_RELS = ["links_to", ...AILSS_TYPED_LINK_KEYS] as const;

function normalizeRelList(input: string[] | undefined): string[] {
  const raw = (input && input.length > 0 ? input : DEFAULT_RELS)
    .map((r) => r.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

export function registerFindBrokenLinksTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "find_broken_links",
    {
      title: "Find broken links",
      description:
        "Detects broken wikilinks/typed links by scanning the index DB typed_links table and resolving targets against indexed notes. Works without AILSS_VAULT_PATH (DB-only).",
      inputSchema: {
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only check links from notes under this vault-relative path prefix"),
        rels: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Which link relations to check (default: ["links_to", ...frontmatter typed-link keys])',
          ),
        max_links: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .default(20_000)
          .describe("Hard limit on typed_links rows scanned (safety bound)"),
        max_broken: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(2000)
          .describe("Maximum number of broken-link rows returned (safety bound)"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum resolved note paths per target"),
      },
      outputSchema: z.object({
        path_prefix: z.string().nullable(),
        rels: z.array(z.string()),
        scanned_links: z.number().int().nonnegative(),
        broken_total: z.number().int().nonnegative(),
        truncated: z.boolean(),
        broken_truncated: z.boolean(),
        broken: z.array(
          z.object({
            from_path: z.string(),
            rel: z.string(),
            target: z.string(),
            to_wikilink: z.string(),
            resolutions: z.array(
              z.object({
                path: z.string(),
                title: z.string().nullable(),
                matched_by: z.union([z.literal("path"), z.literal("note_id"), z.literal("title")]),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      const prefix = args.path_prefix ? args.path_prefix.trim() : null;
      const rels = normalizeRelList(args.rels);

      const where: string[] = [];
      const params: unknown[] = [];

      if (prefix) {
        where.push(`from_path LIKE ?`);
        params.push(`${prefix}%`);
      }

      if (rels.length > 0) {
        where.push(`rel IN (${rels.map(() => "?").join(", ")})`);
        params.push(...rels);
      }

      const sql = `
        SELECT
          from_path AS from_path,
          rel AS rel,
          to_target AS to_target,
          to_wikilink AS to_wikilink,
          position AS position
        FROM typed_links
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY from_path, rel, position
        LIMIT ?
      `;

      const rows = deps.db.prepare(sql).all(...params, args.max_links) as Array<{
        from_path: string;
        rel: string;
        to_target: string;
        to_wikilink: string;
        position: number;
      }>;

      const resolveCache = new Map<string, ReturnType<typeof resolveNotePathsByWikilinkTarget>>();
      const resolveCached = (
        target: string,
      ): ReturnType<typeof resolveNotePathsByWikilinkTarget> => {
        if (resolveCache.has(target)) return resolveCache.get(target) ?? [];
        const resolved = resolveNotePathsByWikilinkTarget(
          deps.db,
          target,
          args.max_resolutions_per_target,
        );
        resolveCache.set(target, resolved);
        return resolved;
      };

      const broken: Array<{
        from_path: string;
        rel: string;
        target: string;
        to_wikilink: string;
        resolutions: Array<{
          path: string;
          title: string | null;
          matched_by: "path" | "note_id" | "title";
        }>;
      }> = [];

      let brokenTotal = 0;
      let brokenTruncated = false;

      for (const row of rows) {
        const target = (row.to_target ?? "").trim();
        if (!target) continue;

        const resolved = resolveCached(target);
        if (resolved.length > 0) continue;

        brokenTotal += 1;
        if (broken.length >= args.max_broken) {
          brokenTruncated = true;
          continue;
        }

        broken.push({
          from_path: row.from_path,
          rel: row.rel,
          target,
          to_wikilink: row.to_wikilink,
          resolutions: resolved.map((r) => ({
            path: r.path,
            title: r.title,
            matched_by: r.matchedBy,
          })),
        });
      }

      const payload = {
        path_prefix: prefix,
        rels,
        scanned_links: rows.length,
        broken_total: brokenTotal,
        truncated: rows.length >= args.max_links,
        broken_truncated: brokenTruncated,
        broken,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
