// get_vault_graph tool
// - DB-backed typed-link graph (metadata only; no note body contents)

import {
  getNoteMeta,
  resolveNotePathsByWikilinkTarget,
  searchNotes,
  type ResolvedNoteTarget,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

type GraphNode = {
  path: string;
  note_id: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  viewed: number | null;
  tags: string[];
  keywords: string[];
  frontmatter: Record<string, unknown>;
};

type GraphEdge = {
  from_path: string;
  rel: string;
  to_target: string;
  to_wikilink: string;
  position: number;
  to_paths: Array<{ path: string; matched_by: "path" | "title" }>;
};

function toGraphNode(meta: ReturnType<typeof getNoteMeta> | null, path: string): GraphNode {
  return {
    path,
    note_id: meta?.noteId ?? null,
    created: meta?.created ?? null,
    title: meta?.title ?? null,
    summary: meta?.summary ?? null,
    entity: meta?.entity ?? null,
    layer: meta?.layer ?? null,
    status: meta?.status ?? null,
    updated: meta?.updated ?? null,
    viewed: meta?.viewed ?? null,
    tags: meta?.tags ?? [],
    keywords: meta?.keywords ?? [],
    frontmatter: (meta?.frontmatter ?? {}) as Record<string, unknown>,
  };
}

function toResolvedPathItems(
  rows: ResolvedNoteTarget[],
): Array<{ path: string; matched_by: "path" | "title" }> {
  return rows.map((r) => ({ path: r.path, matched_by: r.matchedBy }));
}

export function registerGetVaultGraphTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_vault_graph",
    {
      title: "Get vault graph",
      description:
        "Returns a typed-link graph from the index DB (nodes: note metadata/frontmatter; edges: typed links). Does not read note body contents. Requires the vault to be indexed.",
      inputSchema: {
        seed_paths: z
          .array(z.string().min(1))
          .optional()
          .describe("Seed note paths (vault-relative) to start graph expansion from"),
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Alternative to seed_paths: build a subgraph for notes under this path prefix"),
        max_hops: z
          .number()
          .int()
          .min(0)
          .max(5)
          .default(1)
          .describe("Expansion depth when seed_paths is used (0–5)"),
        max_nodes: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe("Maximum nodes to return (1–500)"),
        max_edges: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(500)
          .describe("Maximum edges to return (1–5000)"),
        rels: z
          .array(z.string().min(1))
          .optional()
          .describe("If provided, include only typed links whose rel is in this list"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(5)
          .describe("Maximum note paths to resolve per typed-link target"),
      },
      outputSchema: z.object({
        mode: z.union([z.literal("seed_paths"), z.literal("path_prefix")]),
        seeds: z.array(z.string()),
        path_prefix: z.string().nullable(),
        max_hops: z.number().int(),
        max_nodes: z.number().int(),
        max_edges: z.number().int(),
        truncated: z.boolean(),
        nodes: z.array(
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
            viewed: z.number().nullable(),
            tags: z.array(z.string()),
            keywords: z.array(z.string()),
            frontmatter: z.record(z.any()),
          }),
        ),
        edges: z.array(
          z.object({
            from_path: z.string(),
            rel: z.string(),
            to_target: z.string(),
            to_wikilink: z.string(),
            position: z.number().int(),
            to_paths: z.array(
              z.object({
                path: z.string(),
                matched_by: z.union([z.literal("path"), z.literal("title")]),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      const relFilter = args.rels ? new Set(args.rels) : null;

      const seedsFromPrefix = (prefix: string): string[] =>
        searchNotes(deps.db, { pathPrefix: prefix, limit: args.max_nodes }).map((r) => r.path);

      const mode = args.seed_paths?.length ? "seed_paths" : args.path_prefix ? "path_prefix" : null;
      if (!mode) {
        throw new Error('Provide either seed_paths (non-empty) or path_prefix (e.g. "Projects/").');
      }

      const seeds =
        mode === "seed_paths" ? (args.seed_paths ?? []) : seedsFromPrefix(args.path_prefix ?? "");
      const prefix = mode === "path_prefix" ? (args.path_prefix ?? "").trim() : null;

      const visited = new Set<string>();
      const queue: Array<{ path: string; hop: number }> = [];

      for (const seed of seeds) {
        const p = seed.trim();
        if (!p) continue;
        if (visited.has(p)) continue;
        visited.add(p);
        queue.push({ path: p, hop: 0 });
        if (visited.size >= args.max_nodes) break;
      }

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      let truncated = false;

      while (queue.length > 0) {
        const node = queue.shift();
        if (!node) break;

        const meta = getNoteMeta(deps.db, node.path);
        nodes.push(toGraphNode(meta, node.path));

        const shouldExpand = mode === "seed_paths" ? node.hop < args.max_hops : false; // prefix mode: no expansion outside the set
        if (!shouldExpand) continue;
        if (!meta) continue;

        for (const link of meta.typedLinks) {
          if (edges.length >= args.max_edges) {
            truncated = true;
            break;
          }
          if (relFilter && !relFilter.has(link.rel)) continue;

          const resolved = resolveNotePathsByWikilinkTarget(
            deps.db,
            link.toTarget,
            args.max_resolutions_per_target,
          );

          edges.push({
            from_path: node.path,
            rel: link.rel,
            to_target: link.toTarget,
            to_wikilink: link.toWikilink,
            position: link.position,
            to_paths: toResolvedPathItems(resolved),
          });

          for (const resolvedItem of resolved) {
            if (visited.size >= args.max_nodes) break;
            if (visited.has(resolvedItem.path)) continue;
            visited.add(resolvedItem.path);
            queue.push({ path: resolvedItem.path, hop: node.hop + 1 });
          }
        }
      }

      if (mode === "path_prefix" && prefix) {
        const wanted = seedsFromPrefix(prefix);
        const wantedSet = new Set(wanted);

        // Prefix mode: rewrite to a strict subgraph of the wanted set.
        const prefixNodes: GraphNode[] = [];
        for (const p of wanted) {
          prefixNodes.push(toGraphNode(getNoteMeta(deps.db, p), p));
        }

        const prefixEdges: GraphEdge[] = [];
        for (const p of wanted) {
          if (prefixEdges.length >= args.max_edges) {
            truncated = true;
            break;
          }
          const meta = getNoteMeta(deps.db, p);
          if (!meta) continue;
          for (const link of meta.typedLinks) {
            if (prefixEdges.length >= args.max_edges) {
              truncated = true;
              break;
            }
            if (relFilter && !relFilter.has(link.rel)) continue;
            const resolved = resolveNotePathsByWikilinkTarget(
              deps.db,
              link.toTarget,
              args.max_resolutions_per_target,
            ).filter((r) => wantedSet.has(r.path));

            if (resolved.length === 0) continue;
            prefixEdges.push({
              from_path: p,
              rel: link.rel,
              to_target: link.toTarget,
              to_wikilink: link.toWikilink,
              position: link.position,
              to_paths: toResolvedPathItems(resolved),
            });
          }
        }

        const payload = {
          mode,
          seeds: wanted,
          path_prefix: prefix,
          max_hops: args.max_hops,
          max_nodes: args.max_nodes,
          max_edges: args.max_edges,
          truncated,
          nodes: prefixNodes,
          edges: prefixEdges,
        };

        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }

      const payload = {
        mode,
        seeds,
        path_prefix: prefix,
        max_hops: args.max_hops,
        max_nodes: args.max_nodes,
        max_edges: args.max_edges,
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
