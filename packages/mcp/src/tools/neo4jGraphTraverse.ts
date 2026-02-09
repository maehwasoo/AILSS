// neo4j_graph_traverse tool
// - optional multi-hop traversal over Neo4j graph mirror

import {
  getNoteMeta,
  resolveNotePathsByWikilinkTarget,
  traverseNeo4jGraph,
  type Neo4jTraversalDirection,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

type TraversalNodePayload = {
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
};

type TraversalEdgePayload = {
  direction: "outgoing" | "incoming";
  from_path: string;
  to_path: string | null;
  rel: string;
  target: string;
  to_wikilink: string;
};

type SqliteFallbackTraversal = {
  nodes: TraversalNodePayload[];
  edges: TraversalEdgePayload[];
  truncated: boolean;
};

function toNodePayload(deps: McpToolDeps, notePath: string, hop: number): TraversalNodePayload {
  const meta = getNoteMeta(deps.db, notePath);
  return {
    path: notePath,
    hop,
    title: meta?.title ?? null,
    summary: meta?.summary ?? null,
    entity: meta?.entity ?? null,
    layer: meta?.layer ?? null,
    status: meta?.status ?? null,
    updated: meta?.updated ?? null,
    tags: meta?.tags ?? [],
    keywords: meta?.keywords ?? [],
  };
}

function runSqliteFallbackTraversal(
  deps: McpToolDeps,
  args: {
    path: string;
    max_hops: number;
    max_notes: number;
    max_edges: number;
    max_links_per_note: number;
    include_unresolved_targets: boolean;
  },
): SqliteFallbackTraversal {
  const seedMeta = getNoteMeta(deps.db, args.path);
  if (!seedMeta) {
    throw new Error(
      `Note metadata not found for path="${args.path}". Re-run indexing so typed links are available.`,
    );
  }

  const nodes: TraversalNodePayload[] = [];
  const edges: TraversalEdgePayload[] = [];
  const edgeSeen = new Set<string>();
  const visited = new Set<string>([args.path]);
  const queue: Array<{ path: string; hop: number }> = [{ path: args.path, hop: 0 }];

  let truncated = false;

  while (queue.length > 0 && nodes.length < args.max_notes) {
    const current = queue.shift();
    if (!current) break;

    nodes.push(toNodePayload(deps, current.path, current.hop));
    if (current.hop >= args.max_hops) continue;

    const meta = getNoteMeta(deps.db, current.path);
    if (!meta) continue;

    for (const link of meta.typedLinks.slice(0, args.max_links_per_note)) {
      const resolved = resolveNotePathsByWikilinkTarget(deps.db, link.toTarget, 20);

      if (resolved.length === 0 && args.include_unresolved_targets) {
        const unresolvedKey = [
          "outgoing",
          current.path,
          "",
          link.rel,
          link.toTarget,
          link.toWikilink,
        ].join("::");
        if (!edgeSeen.has(unresolvedKey)) {
          if (edges.length >= args.max_edges) {
            truncated = true;
            break;
          }
          edgeSeen.add(unresolvedKey);
          edges.push({
            direction: "outgoing",
            from_path: current.path,
            to_path: null,
            rel: link.rel,
            target: link.toTarget,
            to_wikilink: link.toWikilink,
          });
        }
      }

      for (const match of resolved) {
        const edgeKey = [
          "outgoing",
          current.path,
          match.path,
          link.rel,
          link.toTarget,
          link.toWikilink,
        ].join("::");
        if (edgeSeen.has(edgeKey)) continue;

        if (edges.length >= args.max_edges) {
          truncated = true;
          break;
        }

        edgeSeen.add(edgeKey);
        edges.push({
          direction: "outgoing",
          from_path: current.path,
          to_path: match.path,
          rel: link.rel,
          target: link.toTarget,
          to_wikilink: link.toWikilink,
        });

        if (visited.has(match.path)) continue;
        if (nodes.length + queue.length >= args.max_notes) {
          truncated = true;
          continue;
        }
        visited.add(match.path);
        queue.push({ path: match.path, hop: current.hop + 1 });
      }

      if (truncated) break;
    }

    if (truncated) break;
  }

  return { nodes, edges, truncated };
}

export function registerNeo4jGraphTraverseTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "neo4j_graph_traverse",
    {
      title: "Neo4j graph traverse",
      description:
        "Traverses the optional Neo4j graph mirror for multi-hop typed-link exploration. Falls back to SQLite outgoing traversal when Neo4j is unavailable.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative seed note path"),
        direction: z
          .enum(["outgoing", "incoming", "both"])
          .default("both")
          .describe("Traversal direction over resolved typed-link graph"),
        max_hops: z.number().int().min(1).max(6).default(2).describe("Maximum traversal depth"),
        max_notes: z
          .number()
          .int()
          .min(1)
          .max(400)
          .default(80)
          .describe("Maximum number of note nodes returned"),
        max_edges: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(1500)
          .describe("Maximum number of edges returned"),
        max_links_per_note: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(80)
          .describe("Maximum graph edges queried per expanded note"),
        include_unresolved_targets: z
          .boolean()
          .default(false)
          .describe("Include unresolved targets as edges with to_path=null"),
      },
      outputSchema: z.object({
        backend: z.enum(["neo4j", "sqlite_fallback"]),
        reason: z.string().nullable(),
        seed_path: z.string(),
        params: z.object({
          direction: z.enum(["outgoing", "incoming", "both"]),
          max_hops: z.number().int(),
          max_notes: z.number().int(),
          max_edges: z.number().int(),
          max_links_per_note: z.number().int(),
          include_unresolved_targets: z.boolean(),
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
            direction: z.enum(["outgoing", "incoming"]),
            from_path: z.string(),
            to_path: z.string().nullable(),
            rel: z.string(),
            target: z.string(),
            to_wikilink: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const neo4j = deps.neo4j ?? {
        enabled: false,
        syncOnIndex: false,
        strictMode: false,
        config: null,
        unavailableReason: "Neo4j integration is not configured in this MCP runtime.",
      };
      const direction = args.direction as Neo4jTraversalDirection;
      const baseParams = {
        direction,
        max_hops: args.max_hops,
        max_notes: args.max_notes,
        max_edges: args.max_edges,
        max_links_per_note: args.max_links_per_note,
        include_unresolved_targets: args.include_unresolved_targets,
      };

      if (!neo4j.enabled || !neo4j.config) {
        const fallback = runSqliteFallbackTraversal(deps, {
          path: args.path,
          max_hops: args.max_hops,
          max_notes: args.max_notes,
          max_edges: args.max_edges,
          max_links_per_note: args.max_links_per_note,
          include_unresolved_targets: args.include_unresolved_targets,
        });
        const payload = {
          backend: "sqlite_fallback" as const,
          reason:
            direction === "outgoing"
              ? (neo4j.unavailableReason ?? "Neo4j unavailable.")
              : `Neo4j unavailable. Fallback only supports outgoing traversal. Requested direction=${direction}.`,
          seed_path: args.path,
          params: baseParams,
          truncated: fallback.truncated,
          nodes: fallback.nodes,
          edges: fallback.edges,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }

      try {
        const traversal = await traverseNeo4jGraph(neo4j.config, {
          path: args.path,
          direction,
          maxHops: args.max_hops,
          maxNotes: args.max_notes,
          maxEdges: args.max_edges,
          maxLinksPerNote: args.max_links_per_note,
          includeUnresolvedTargets: args.include_unresolved_targets,
        });

        const nodes = traversal.nodes.map((node) => toNodePayload(deps, node.path, node.hop));
        const edges = traversal.edges.map((edge) => ({
          direction: edge.direction,
          from_path: edge.fromPath,
          to_path: edge.toPath,
          rel: edge.rel,
          target: edge.target,
          to_wikilink: edge.toWikilink,
        }));

        const payload = {
          backend: "neo4j" as const,
          reason: null,
          seed_path: args.path,
          params: baseParams,
          truncated: traversal.truncated,
          nodes,
          edges,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        const fallback = runSqliteFallbackTraversal(deps, {
          path: args.path,
          max_hops: args.max_hops,
          max_notes: args.max_notes,
          max_edges: args.max_edges,
          max_links_per_note: args.max_links_per_note,
          include_unresolved_targets: args.include_unresolved_targets,
        });
        const message = error instanceof Error ? error.message : String(error);
        const payload = {
          backend: "sqlite_fallback" as const,
          reason: `Neo4j traversal failed; fallback used: ${message}`,
          seed_path: args.path,
          params: baseParams,
          truncated: fallback.truncated,
          nodes: fallback.nodes,
          edges: fallback.edges,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }
    },
  );
}
