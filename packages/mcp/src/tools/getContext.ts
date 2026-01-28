// get_context tool
// - semantic search + note previews

import { semanticSearch } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { embedQuery } from "../lib/openaiEmbeddings.js";
import { readVaultFileText } from "../lib/vaultFs.js";

export function registerGetContextTool(server: McpServer, deps: McpToolDeps): void {
  const defaultTopK = parseDefaultTopKFromEnv(process.env.AILSS_GET_CONTEXT_DEFAULT_TOP_K);

  server.registerTool(
    "get_context",
    {
      title: "Get context",
      description:
        "Builds a context set for a query: semantic search over indexed chunks, then returns the top matching notes (deduped by path) with short previews (when AILSS_VAULT_PATH is set).",
      inputSchema: {
        query: z.string().min(1).describe("User question/task to retrieve related notes for"),
        top_k: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(defaultTopK)
          .describe("Maximum number of note results to return (1–50)"),
        max_chars_per_note: z
          .number()
          .int()
          .min(200)
          .max(50_000)
          .default(800)
          .describe("Preview size per note (characters)"),
      },
      outputSchema: z.object({
        query: z.string(),
        top_k: z.number().int(),
        db: z.string(),
        used_chunks_k: z.number().int(),
        results: z.array(
          z.object({
            path: z.string(),
            distance: z.number(),
            heading: z.string().nullable(),
            heading_path: z.array(z.string()),
            snippet: z.string(),
            preview: z.string().nullable(),
            preview_truncated: z.boolean(),
          }),
        ),
      }),
    },
    async (args) => {
      const queryEmbedding = await embedQuery(deps.openai, deps.embeddingModel, args.query);

      // Over-fetch chunks so we can dedupe by note path.
      const usedChunksK = Math.min(50, Math.max(args.top_k, args.top_k * 5));
      const chunkHits = semanticSearch(deps.db, queryEmbedding, usedChunksK);

      const bestByPath = new Map<string, (typeof chunkHits)[number]>();
      for (const hit of chunkHits) {
        const existing = bestByPath.get(hit.path);
        if (!existing || hit.distance < existing.distance) {
          bestByPath.set(hit.path, hit);
        }
      }

      const ordered = Array.from(bestByPath.values())
        .sort((a, b) => a.distance - b.distance)
        .slice(0, args.top_k);

      const results: Array<{
        path: string;
        distance: number;
        heading: string | null;
        heading_path: string[];
        snippet: string;
        preview: string | null;
        preview_truncated: boolean;
      }> = [];

      for (const hit of ordered) {
        if (!deps.vaultPath) {
          results.push({
            path: hit.path,
            distance: hit.distance,
            heading: hit.heading,
            heading_path: hit.headingPath,
            snippet: hit.content.slice(0, 300),
            preview: null,
            preview_truncated: false,
          });
          continue;
        }

        const { text, truncated } = await readVaultFileText({
          vaultPath: deps.vaultPath,
          vaultRelPath: hit.path,
          maxChars: args.max_chars_per_note,
        });

        results.push({
          path: hit.path,
          distance: hit.distance,
          heading: hit.heading,
          heading_path: hit.headingPath,
          snippet: hit.content.slice(0, 300),
          preview: text,
          preview_truncated: truncated,
        });
      }

      const payload = {
        query: args.query,
        top_k: args.top_k,
        db: deps.dbPath,
        used_chunks_k: usedChunksK,
        results,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

function parseDefaultTopKFromEnv(raw: string | undefined): number {
  const defaultTopK = 10;
  if (!raw) return defaultTopK;
  const trimmed = raw.trim();
  if (!trimmed) return defaultTopK;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return defaultTopK;

  const n = Math.floor(parsed);
  if (n < 1) return 1;
  if (n > 50) return 50;
  return n;
}
