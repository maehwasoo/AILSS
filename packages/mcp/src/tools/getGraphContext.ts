// get_graph_context tool
// - GraphRAG-style retrieval: semantic seeds + bounded typed-link expansion + curated snippets

import {
  AILSS_TYPED_LINK_KEYS,
  findNotesByTypedLink,
  getNoteMeta,
  resolveNotePathsByWikilinkTarget,
  semanticSearch,
} from "@ailss/core";
import type { NoteMeta } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { embedQuery } from "../lib/openaiEmbeddings.js";

const DEFAULT_RELS = [...AILSS_TYPED_LINK_KEYS] as const;
const HOP_PENALTY = 0.15;

type GraphEdgeDirection = "outgoing" | "incoming";

type RankedChunk = ReturnType<typeof semanticSearch>[number];

type NodeState = {
  path: string;
  hop: number;
  minSeedDistance: number;
  graphScore: number;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  keywords: string[];
};

function normalizeRelList(input: string[] | undefined): string[] {
  const raw = (input && input.length > 0 ? input : [...DEFAULT_RELS])
    .map((rel) => rel.trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const rel of raw) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

function isPathInScope(notePath: string, pathPrefix: string | null): boolean {
  if (!pathPrefix) return true;
  return notePath.startsWith(pathPrefix);
}

function maxSeedChunkK(seedTopK: number): number {
  return Math.min(500, Math.max(50, seedTopK * 20));
}

function maxContextChunkK(maxNotes: number, maxChunksPerNote: number): number {
  return Math.min(2000, Math.max(200, maxNotes * maxChunksPerNote * 8));
}

function pathWithoutMd(notePath: string): string {
  if (notePath.toLowerCase().endsWith(".md")) return notePath.slice(0, -3);
  return notePath;
}

function basename(notePath: string): string {
  const normalized = notePath.replaceAll("\\", "/");
  return normalized.split("/").pop() ?? normalized;
}

function incomingTargetsForNote(meta: NoteMeta): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    targets.push(trimmed);
  };

  add(meta.noteId);
  add(meta.title);
  add(meta.path);
  add(pathWithoutMd(meta.path));

  const base = basename(meta.path);
  add(base);
  add(pathWithoutMd(base));

  return targets;
}

function chunkSnippet(content: string): string {
  return content.slice(0, 300);
}

function compareNumbersThenPath(
  a: { score: number; path: string },
  b: { score: number; path: string },
) {
  if (a.score !== b.score) return a.score - b.score;
  return a.path.localeCompare(b.path);
}

export function registerGetGraphContextTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_graph_context",
    {
      title: "Get graph context",
      description:
        "GraphRAG-style retrieval: semantic seeds + bounded typed-link expansion + curated snippets (DB-first, no vault body reads).",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("User question/task to retrieve graph-grounded context for"),
        seed_top_k: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Number of semantic seed notes to start from"),
        max_hops: z
          .number()
          .int()
          .min(0)
          .max(2)
          .default(1)
          .describe("Maximum typed-link expansion depth from seed notes"),
        rels: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Typed-link relations to include (default: canonical frontmatter typed-link keys)",
          ),
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Optional vault-relative path prefix to constrain retrieval + graph expansion"),
        include_backrefs: z
          .boolean()
          .default(false)
          .describe("Whether to include incoming typed-link edges during expansion"),
        max_notes: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(80)
          .describe("Maximum graph note nodes returned"),
        max_edges: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(2000)
          .describe("Maximum graph edges returned"),
        max_links_per_note: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(40)
          .describe("Maximum typed-link edges followed per note per direction"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum resolved note paths per typed-link target"),
        max_chunks_per_note: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe("Maximum semantic snippets per returned note"),
      },
      outputSchema: z.object({
        query: z.string(),
        params: z.object({
          seed_top_k: z.number().int(),
          max_hops: z.number().int(),
          rels: z.array(z.string()),
          path_prefix: z.string().nullable(),
          include_backrefs: z.boolean(),
          max_notes: z.number().int(),
          max_edges: z.number().int(),
          max_links_per_note: z.number().int(),
          max_resolutions_per_target: z.number().int(),
          max_chunks_per_note: z.number().int(),
        }),
        db: z.string(),
        used_seed_chunks_k: z.number().int(),
        used_context_chunks_k: z.number().int(),
        seeds: z.array(
          z.object({
            path: z.string(),
            distance: z.number(),
            heading: z.string().nullable(),
            heading_path: z.array(z.string()),
            snippet: z.string(),
          }),
        ),
        graph: z.object({
          truncated: z.boolean(),
          nodes: z.array(
            z.object({
              path: z.string(),
              hop: z.number().int().nonnegative(),
              min_seed_distance: z.number(),
              graph_score: z.number(),
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
        context_notes: z.array(
          z.object({
            path: z.string(),
            hop: z.number().int().nonnegative(),
            score: z.number(),
            title: z.string().nullable(),
            summary: z.string().nullable(),
            entity: z.string().nullable(),
            layer: z.string().nullable(),
            status: z.string().nullable(),
            updated: z.string().nullable(),
            tags: z.array(z.string()),
            keywords: z.array(z.string()),
            snippets: z.array(
              z.object({
                distance: z.number(),
                heading: z.string().nullable(),
                heading_path: z.array(z.string()),
                snippet: z.string(),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      const rels = normalizeRelList(args.rels);
      const relSet = new Set<string>(rels);
      const pathPrefix = args.path_prefix ? args.path_prefix.trim() : null;

      const queryEmbedding = await embedQuery(deps.openai, deps.embeddingModel, args.query);

      const usedSeedChunksK = maxSeedChunkK(args.seed_top_k);
      const seedChunkHits = semanticSearch(deps.db, queryEmbedding, usedSeedChunksK).filter((hit) =>
        isPathInScope(hit.path, pathPrefix),
      );

      const seedByPath = new Map<string, RankedChunk>();
      for (const hit of seedChunkHits) {
        const existing = seedByPath.get(hit.path);
        if (!existing || hit.distance < existing.distance) {
          seedByPath.set(hit.path, hit);
        }
      }

      const seeds = Array.from(seedByPath.values())
        .sort((a, b) => {
          if (a.distance !== b.distance) return a.distance - b.distance;
          return a.path.localeCompare(b.path);
        })
        .slice(0, args.seed_top_k);

      const metaCache = new Map<string, NoteMeta | null>();
      const getMetaCached = (notePath: string): NoteMeta | null => {
        if (metaCache.has(notePath)) return metaCache.get(notePath) ?? null;
        const meta = getNoteMeta(deps.db, notePath);
        metaCache.set(notePath, meta);
        return meta;
      };

      const nodeMap = new Map<string, NodeState>();
      const edgeMap = new Map<
        string,
        {
          direction: GraphEdgeDirection;
          rel: string;
          target: string;
          from_path: string;
          to_path: string;
          to_wikilink: string;
        }
      >();
      const queue: Array<{ path: string; hop: number; seedDistance: number }> = [];
      let truncated = false;

      const upsertNode = (
        notePath: string,
        hop: number,
        seedDistance: number,
      ): { shouldQueue: boolean } => {
        if (!isPathInScope(notePath, pathPrefix)) return { shouldQueue: false };

        const existing = nodeMap.get(notePath);
        const graphScore = seedDistance + hop * HOP_PENALTY;
        if (existing) {
          let changed = false;
          if (hop < existing.hop) {
            existing.hop = hop;
            changed = true;
          }
          if (seedDistance < existing.minSeedDistance) {
            existing.minSeedDistance = seedDistance;
            changed = true;
          }
          const nextGraphScore = existing.minSeedDistance + existing.hop * HOP_PENALTY;
          if (nextGraphScore < existing.graphScore) {
            existing.graphScore = nextGraphScore;
            changed = true;
          }
          return { shouldQueue: changed && hop <= args.max_hops };
        }

        if (nodeMap.size >= args.max_notes) {
          truncated = true;
          return { shouldQueue: false };
        }

        const meta = getMetaCached(notePath);
        nodeMap.set(notePath, {
          path: notePath,
          hop,
          minSeedDistance: seedDistance,
          graphScore,
          title: meta?.title ?? null,
          summary: meta?.summary ?? null,
          entity: meta?.entity ?? null,
          layer: meta?.layer ?? null,
          status: meta?.status ?? null,
          updated: meta?.updated ?? null,
          tags: meta?.tags ?? [],
          keywords: meta?.keywords ?? [],
        });
        return { shouldQueue: hop <= args.max_hops };
      };

      const pushEdge = (edge: {
        direction: GraphEdgeDirection;
        rel: string;
        target: string;
        from_path: string;
        to_path: string;
        to_wikilink: string;
      }): boolean => {
        if (edgeMap.size >= args.max_edges) {
          truncated = true;
          return false;
        }

        const key = [
          edge.direction,
          edge.rel,
          edge.target,
          edge.from_path,
          edge.to_path,
          edge.to_wikilink,
        ].join("|");
        if (edgeMap.has(key)) return true;
        edgeMap.set(key, edge);
        return true;
      };

      for (const seed of seeds) {
        const upserted = upsertNode(seed.path, 0, seed.distance);
        if (!upserted.shouldQueue) continue;
        queue.push({ path: seed.path, hop: 0, seedDistance: seed.distance });
      }

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const currentNode = nodeMap.get(current.path);
        if (!currentNode) continue;
        if (current.hop > currentNode.hop) continue;
        if (current.hop >= args.max_hops) continue;

        const meta = getMetaCached(current.path);
        if (!meta) continue;

        let outgoingFollowed = 0;
        for (const link of meta.typedLinks) {
          if (!relSet.has(link.rel)) continue;

          const resolved = resolveNotePathsByWikilinkTarget(
            deps.db,
            link.toTarget,
            args.max_resolutions_per_target,
          );

          for (const match of resolved) {
            if (outgoingFollowed >= args.max_links_per_note) {
              truncated = true;
              break;
            }
            if (!isPathInScope(match.path, pathPrefix)) continue;

            const edgeCountBefore = edgeMap.size;
            const pushed = pushEdge({
              direction: "outgoing",
              rel: link.rel,
              target: link.toTarget,
              from_path: current.path,
              to_path: match.path,
              to_wikilink: link.toWikilink,
            });
            if (!pushed) break;
            if (edgeMap.size > edgeCountBefore) {
              outgoingFollowed += 1;
            }

            const nextHop = current.hop + 1;
            const upserted = upsertNode(match.path, nextHop, current.seedDistance);
            if (upserted.shouldQueue) {
              queue.push({ path: match.path, hop: nextHop, seedDistance: current.seedDistance });
            }
          }

          if (edgeMap.size >= args.max_edges) break;
        }

        if (!args.include_backrefs || edgeMap.size >= args.max_edges) continue;

        const incomingTargets = incomingTargetsForNote(meta);
        const incomingSeen = new Set<string>();
        let incomingFollowed = 0;
        const perTargetLimit = Math.min(1000, Math.max(50, args.max_links_per_note * 5));

        for (const target of incomingTargets) {
          if (incomingFollowed >= args.max_links_per_note) {
            truncated = true;
            break;
          }

          const backrefs = findNotesByTypedLink(deps.db, {
            toTarget: target,
            limit: perTargetLimit,
          });

          for (const backref of backrefs) {
            if (!relSet.has(backref.rel)) continue;
            if (!isPathInScope(backref.fromPath, pathPrefix)) continue;

            const incomingKey = `${backref.rel}|${backref.fromPath}|${current.path}|${backref.toTarget}|${backref.toWikilink}`;
            if (incomingSeen.has(incomingKey)) continue;
            incomingSeen.add(incomingKey);

            incomingFollowed += 1;
            if (incomingFollowed > args.max_links_per_note) {
              truncated = true;
              break;
            }

            const pushed = pushEdge({
              direction: "incoming",
              rel: backref.rel,
              target: backref.toTarget,
              from_path: backref.fromPath,
              to_path: current.path,
              to_wikilink: backref.toWikilink,
            });
            if (!pushed) break;

            const nextHop = current.hop + 1;
            const upserted = upsertNode(backref.fromPath, nextHop, current.seedDistance);
            if (upserted.shouldQueue) {
              queue.push({
                path: backref.fromPath,
                hop: nextHop,
                seedDistance: current.seedDistance,
              });
            }
          }

          if (edgeMap.size >= args.max_edges) break;
        }
      }

      const candidatePaths = new Set(nodeMap.keys());
      const usedContextChunksK = candidatePaths.size
        ? maxContextChunkK(args.max_notes, args.max_chunks_per_note)
        : 0;
      const contextChunkHits = usedContextChunksK
        ? semanticSearch(deps.db, queryEmbedding, usedContextChunksK).filter(
            (hit) => candidatePaths.has(hit.path) && isPathInScope(hit.path, pathPrefix),
          )
        : [];

      const snippetsByPath = new Map<string, RankedChunk[]>();
      for (const hit of contextChunkHits) {
        const snippets = snippetsByPath.get(hit.path) ?? [];
        snippets.push(hit);
        snippets.sort((a, b) => a.distance - b.distance);
        if (snippets.length > args.max_chunks_per_note) {
          snippets.length = args.max_chunks_per_note;
        }
        snippetsByPath.set(hit.path, snippets);
      }

      const nodes = Array.from(nodeMap.values())
        .sort((a, b) => {
          if (a.hop !== b.hop) return a.hop - b.hop;
          return compareNumbersThenPath(
            { score: a.graphScore, path: a.path },
            { score: b.graphScore, path: b.path },
          );
        })
        .map((node) => ({
          path: node.path,
          hop: node.hop,
          min_seed_distance: node.minSeedDistance,
          graph_score: node.graphScore,
          title: node.title,
          summary: node.summary,
          entity: node.entity,
          layer: node.layer,
          status: node.status,
          updated: node.updated,
          tags: node.tags,
          keywords: node.keywords,
        }));

      const edges = Array.from(edgeMap.values()).sort((a, b) => {
        if (a.from_path !== b.from_path) return a.from_path.localeCompare(b.from_path);
        if (a.to_path !== b.to_path) return a.to_path.localeCompare(b.to_path);
        if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
        if (a.rel !== b.rel) return a.rel.localeCompare(b.rel);
        if (a.target !== b.target) return a.target.localeCompare(b.target);
        return a.to_wikilink.localeCompare(b.to_wikilink);
      });

      const contextNotes = Array.from(nodeMap.values())
        .map((node) => {
          const snippets = (snippetsByPath.get(node.path) ?? []).map((hit) => ({
            distance: hit.distance,
            heading: hit.heading,
            heading_path: hit.headingPath,
            snippet: chunkSnippet(hit.content),
          }));
          const semanticDistance = snippets[0]?.distance ?? node.minSeedDistance + 1;
          const score = semanticDistance + node.hop * HOP_PENALTY;
          return {
            path: node.path,
            hop: node.hop,
            score,
            title: node.title,
            summary: node.summary,
            entity: node.entity,
            layer: node.layer,
            status: node.status,
            updated: node.updated,
            tags: node.tags,
            keywords: node.keywords,
            snippets,
          };
        })
        .sort((a, b) => compareNumbersThenPath({ score: a.score, path: a.path }, b));

      const payload = {
        query: args.query,
        params: {
          seed_top_k: args.seed_top_k,
          max_hops: args.max_hops,
          rels,
          path_prefix: pathPrefix,
          include_backrefs: args.include_backrefs,
          max_notes: args.max_notes,
          max_edges: args.max_edges,
          max_links_per_note: args.max_links_per_note,
          max_resolutions_per_target: args.max_resolutions_per_target,
          max_chunks_per_note: args.max_chunks_per_note,
        },
        db: deps.dbPath,
        used_seed_chunks_k: usedSeedChunksK,
        used_context_chunks_k: usedContextChunksK,
        seeds: seeds.map((seed) => ({
          path: seed.path,
          distance: seed.distance,
          heading: seed.heading,
          heading_path: seed.headingPath,
          snippet: chunkSnippet(seed.content),
        })),
        graph: {
          truncated,
          nodes,
          edges,
        },
        context_notes: contextNotes,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
