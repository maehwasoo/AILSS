// activate_context tool
// - seed: semantic_search top1
// - expand: typed links up to N hops

import {
  findNotesByTypedLink,
  getNoteMeta,
  guessWikilinkTargetsForNote,
  resolveNotePathsByWikilinkTarget,
  semanticSearch,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { embedQuery } from "../lib/openaiEmbeddings.js";
import { readVaultFileText } from "../lib/vaultFs.js";

type Via = {
  direction: "outgoing" | "incoming";
  rel: string;
  target: string;
  from_path: string;
  to_path: string;
};

export function registerActivateContextTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "activate_context",
    {
      title: "Activate context",
      description:
        "Builds a context set: semantic_search(top1) seed note, then expands to typed-link connected notes up to 2 hops. Returns previews + evidence edges.",
      inputSchema: {
        query: z.string().min(1).describe("User question or task"),
        max_hops: z.number().int().min(0).max(2).default(2).describe("Graph expansion depth (0–2)"),
        max_notes: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(25)
          .describe("Maximum number of notes to return"),
        max_chars_per_note: z
          .number()
          .int()
          .min(200)
          .max(50_000)
          .default(2000)
          .describe("Preview size per note (characters)"),
        max_links_per_note: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(40)
          .describe("Outgoing typed links followed per note"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Max resolved note paths per typed-link target"),
        max_incoming_per_target: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Incoming typed-link backrefs pulled per target"),
      },
      outputSchema: z.object({
        query: z.string(),
        seed: z
          .object({
            path: z.string(),
            heading: z.string().nullable(),
            heading_path: z.array(z.string()),
            distance: z.number(),
            snippet: z.string(),
          })
          .nullable(),
        params: z.object({
          max_hops: z.number().int(),
          max_notes: z.number().int(),
          max_chars_per_note: z.number().int(),
        }),
        activated: z.array(
          z.object({
            path: z.string(),
            hop: z.number().int(),
            title: z.string().nullable(),
            entity: z.string().nullable(),
            layer: z.string().nullable(),
            status: z.string().nullable(),
            via: z
              .object({
                direction: z.union([z.literal("outgoing"), z.literal("incoming")]),
                rel: z.string(),
                target: z.string(),
                from_path: z.string(),
                to_path: z.string(),
              })
              .nullable(),
            preview: z.string().nullable(),
          }),
        ),
      }),
    },
    async (args) => {
      const queryEmbedding = await embedQuery(deps.openai, deps.embeddingModel, args.query);
      const seedHits = semanticSearch(deps.db, queryEmbedding, 1);
      const seed = seedHits[0];

      const emptyPayload = {
        query: args.query,
        seed: null,
        params: {
          max_hops: args.max_hops,
          max_notes: args.max_notes,
          max_chars_per_note: args.max_chars_per_note,
        },
        activated: [],
      };

      if (!seed) {
        return {
          structuredContent: emptyPayload,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ...emptyPayload, note: "No indexed chunks found. Run the indexer first." },
                null,
                2,
              ),
            },
          ],
        };
      }

      type Node = {
        path: string;
        hop: number;
        via: Via | null;
      };

      const visited = new Set<string>([seed.path]);
      const queue: Node[] = [{ path: seed.path, hop: 0, via: null }];
      const metaCache = new Map<string, ReturnType<typeof getNoteMeta> | null>();

      const getMetaCached = (notePath: string): ReturnType<typeof getNoteMeta> | null => {
        if (metaCache.has(notePath)) return metaCache.get(notePath) ?? null;
        const meta = getNoteMeta(deps.db, notePath);
        metaCache.set(notePath, meta);
        return meta;
      };

      const readNotePreview = async (notePath: string): Promise<string | null> => {
        if (!deps.vaultPath) return null;
        const { text } = await readVaultFileText({
          vaultPath: deps.vaultPath,
          vaultRelPath: notePath,
          maxChars: args.max_chars_per_note,
        });
        return text;
      };

      const activated: Array<{
        path: string;
        hop: number;
        title: string | null;
        entity: string | null;
        layer: string | null;
        status: string | null;
        via: Via | null;
        preview: string | null;
      }> = [];

      while (queue.length > 0 && activated.length < args.max_notes) {
        const node = queue.shift();
        if (!node) break;

        const meta = getMetaCached(node.path);
        const preview = await readNotePreview(node.path);
        activated.push({
          path: node.path,
          hop: node.hop,
          title: meta?.title ?? null,
          entity: meta?.entity ?? null,
          layer: meta?.layer ?? null,
          status: meta?.status ?? null,
          via: node.via,
          preview,
        });

        if (node.hop >= args.max_hops) continue;
        if (!meta) continue;

        // Outgoing typed links
        for (const link of meta.typedLinks.slice(0, args.max_links_per_note)) {
          const resolved = resolveNotePathsByWikilinkTarget(
            deps.db,
            link.toTarget,
            args.max_resolutions_per_target,
          );

          for (const match of resolved) {
            const nextPath = match.path;
            if (visited.has(nextPath)) continue;
            visited.add(nextPath);
            queue.push({
              path: nextPath,
              hop: node.hop + 1,
              via: {
                direction: "outgoing",
                rel: link.rel,
                target: link.toTarget,
                from_path: node.path,
                to_path: nextPath,
              },
            });
            if (activated.length + queue.length >= args.max_notes) break;
          }
          if (activated.length + queue.length >= args.max_notes) break;
        }

        // Incoming typed links (backrefs)
        const targets = guessWikilinkTargetsForNote(meta);
        for (const target of targets) {
          const backrefs = findNotesByTypedLink(deps.db, {
            toTarget: target,
            limit: args.max_incoming_per_target,
          });

          for (const backref of backrefs) {
            const nextPath = backref.fromPath;
            if (visited.has(nextPath)) continue;
            visited.add(nextPath);
            queue.push({
              path: nextPath,
              hop: node.hop + 1,
              via: {
                direction: "incoming",
                rel: backref.rel,
                target,
                from_path: nextPath,
                to_path: node.path,
              },
            });
            if (activated.length + queue.length >= args.max_notes) break;
          }
          if (activated.length + queue.length >= args.max_notes) break;
        }
      }

      const payload = {
        query: args.query,
        seed: {
          path: seed.path,
          heading: seed.heading,
          heading_path: seed.headingPath,
          distance: seed.distance,
          snippet: seed.content.slice(0, 300),
        },
        params: {
          max_hops: args.max_hops,
          max_notes: args.max_notes,
          max_chars_per_note: args.max_chars_per_note,
        },
        activated,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
