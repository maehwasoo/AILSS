// get_typed_links tool
// - DB-backed typed-link expansion (incoming + outgoing), up to 2 hops

import {
  findNotesByTypedLink,
  getNoteMeta,
  guessWikilinkTargetsForNote,
  resolveNotePathsByWikilinkTarget,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerGetTypedLinksTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_typed_links",
    {
      title: "Get typed links",
      description:
        "Expands typed links for a specified note path (outgoing + incoming backrefs) up to `max_hops` (0–2). Returns a bounded graph of note metadata (DB-only; no note body reads).",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path to expand from"),
        max_hops: z.number().int().min(0).max(2).default(2).describe("Expansion depth (0–2)"),
        include_outgoing: z.boolean().default(true).describe("Include outgoing typed links"),
        include_incoming: z
          .boolean()
          .default(true)
          .describe("Include incoming typed-link backrefs"),
        max_notes: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Maximum number of note nodes to return (1–200)"),
        max_edges: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(2000)
          .describe("Maximum number of edges to return (1–10,000)"),
        max_links_per_note: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(40)
          .describe("Maximum outgoing typed links followed per note"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum resolved note paths per typed-link target"),
        max_incoming_per_target: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum incoming typed-link backrefs pulled per target"),
      },
      outputSchema: z.object({
        seed_path: z.string(),
        params: z.object({
          max_hops: z.number().int(),
          include_outgoing: z.boolean(),
          include_incoming: z.boolean(),
          max_notes: z.number().int(),
          max_edges: z.number().int(),
        }),
        truncated: z.boolean(),
        nodes: z.array(
          z.object({
            path: z.string(),
            hop: z.number().int().nonnegative(),
            title: z.string().nullable(),
            summary: z.string().nullable(),
            entity: z.string().nullable(),
            layer: z.string().nullable(),
            status: z.string().nullable(),
            updated: z.string().nullable(),
            tags: z.array(z.string()),
            keywords: z.array(z.string()),
          }),
        ),
        edges: z.array(
          z.object({
            direction: z.union([z.literal("outgoing"), z.literal("incoming")]),
            rel: z.string(),
            target: z.string(),
            from_path: z.string(),
            to_path: z.string(),
            to_wikilink: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const seedMeta = getNoteMeta(deps.db, args.path);
      if (!seedMeta) {
        throw new Error(
          `Note metadata not found for path="${args.path}". Re-run indexing so typed links are available.`,
        );
      }

      type QueueNode = { path: string; hop: number };
      const visited = new Set<string>([args.path]);
      const queue: QueueNode[] = [{ path: args.path, hop: 0 }];

      const metaCache = new Map<string, ReturnType<typeof getNoteMeta> | null>();
      const getMetaCached = (notePath: string): ReturnType<typeof getNoteMeta> | null => {
        if (metaCache.has(notePath)) return metaCache.get(notePath) ?? null;
        const meta = getNoteMeta(deps.db, notePath);
        metaCache.set(notePath, meta);
        return meta;
      };

      const nodes: Array<{
        path: string;
        hop: number;
        title: string | null;
        summary: string | null;
        entity: string | null;
        layer: string | null;
        status: string | null;
        updated: string | null;
        tags: string[];
        keywords: string[];
      }> = [];

      const edges: Array<{
        direction: "outgoing" | "incoming";
        rel: string;
        target: string;
        from_path: string;
        to_path: string;
        to_wikilink: string;
      }> = [];

      let truncated = false;

      while (queue.length > 0 && nodes.length < args.max_notes) {
        const node = queue.shift();
        if (!node) break;

        const meta = getMetaCached(node.path);
        nodes.push({
          path: node.path,
          hop: node.hop,
          title: meta?.title ?? null,
          summary: meta?.summary ?? null,
          entity: meta?.entity ?? null,
          layer: meta?.layer ?? null,
          status: meta?.status ?? null,
          updated: meta?.updated ?? null,
          tags: meta?.tags ?? [],
          keywords: meta?.keywords ?? [],
        });

        if (node.hop >= args.max_hops) continue;
        if (!meta) continue;

        if (args.include_outgoing) {
          for (const link of meta.typedLinks.slice(0, args.max_links_per_note)) {
            const resolved = resolveNotePathsByWikilinkTarget(
              deps.db,
              link.toTarget,
              args.max_resolutions_per_target,
            );

            for (const match of resolved) {
              if (edges.length >= args.max_edges) {
                truncated = true;
                break;
              }
              edges.push({
                direction: "outgoing",
                rel: link.rel,
                target: link.toTarget,
                from_path: node.path,
                to_path: match.path,
                to_wikilink: link.toWikilink,
              });

              const nextPath = match.path;
              if (visited.has(nextPath)) continue;
              visited.add(nextPath);
              queue.push({ path: nextPath, hop: node.hop + 1 });
              if (nodes.length + queue.length >= args.max_notes) break;
            }

            if (truncated || nodes.length + queue.length >= args.max_notes) break;
          }
        }

        if (args.include_incoming) {
          const targets = guessWikilinkTargetsForNote(meta);
          for (const target of targets) {
            const backrefs = findNotesByTypedLink(deps.db, {
              toTarget: target,
              limit: args.max_incoming_per_target,
            });

            for (const backref of backrefs) {
              if (edges.length >= args.max_edges) {
                truncated = true;
                break;
              }
              edges.push({
                direction: "incoming",
                rel: backref.rel,
                target: backref.toTarget,
                from_path: backref.fromPath,
                to_path: node.path,
                to_wikilink: backref.toWikilink,
              });

              const nextPath = backref.fromPath;
              if (visited.has(nextPath)) continue;
              visited.add(nextPath);
              queue.push({ path: nextPath, hop: node.hop + 1 });
              if (nodes.length + queue.length >= args.max_notes) break;
            }

            if (truncated || nodes.length + queue.length >= args.max_notes) break;
          }
        }
      }

      const payload = {
        seed_path: args.path,
        params: {
          max_hops: args.max_hops,
          include_outgoing: Boolean(args.include_outgoing),
          include_incoming: Boolean(args.include_incoming),
          max_notes: args.max_notes,
          max_edges: args.max_edges,
        },
        truncated,
        nodes,
        edges,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
