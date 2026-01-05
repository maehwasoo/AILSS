#!/usr/bin/env node
// AILSS MCP server - STDIO transport
// - provides read-only tools like semantic_search and get_note

import OpenAI from "openai";
import { z } from "zod";

import {
  findNotesByTypedLink,
  getNoteMeta,
  guessWikilinkTargetsForNote,
  loadEnv,
  normalizeTypedLinkTargetInput,
  openAilssDb,
  resolveNotePathsByWikilinkTarget,
  resolveDefaultDbPath,
  searchNotes,
  semanticSearch,
} from "@ailss/core";

import { promises as fs } from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const PROMETHEUS_AGENT_INSTRUCTIONS = [
  "Prometheus Agent (AILSS).",
  "",
  "Goal: retrieve vault context like 'neurons activating': seed with semantic similarity, then expand via typed links.",
  "",
  "Read-first workflow:",
  "1) For any vault question, call `activate_context` with the user's query.",
  "2) Use the returned seed + 2-hop typed-link neighborhood as your context.",
  "3) If you need more detail, call `get_note` (content) and/or `get_note_meta` (frontmatter + typed links) for specific paths.",
  "",
  "Safety: do not write to the vault unless the user explicitly asks and confirms a write tool (not provided by default).",
].join("\n");

function embeddingDimForModel(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  return 1536;
}

async function embedQuery(client: OpenAI, model: string, text: string): Promise<number[]> {
  const resp = await client.embeddings.create({
    model,
    input: text,
    encoding_format: "float",
  });
  return resp.data[0]?.embedding as number[];
}

async function main(): Promise<void> {
  const env = loadEnv();

  const embeddingModel = env.openaiEmbeddingModel;
  const embeddingDim = embeddingDimForModel(embeddingModel);

  const vaultPath = env.vaultPath;
  const dbPath = vaultPath ? await resolveDefaultDbPath(vaultPath) : process.env.AILSS_DB_PATH;
  if (!dbPath) {
    throw new Error("DB path is missing. Set AILSS_VAULT_PATH or AILSS_DB_PATH.");
  }

  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Set it via .env or environment variables.");
  }

  const db = openAilssDb({ dbPath, embeddingDim });
  const client = new OpenAI({ apiKey: openaiApiKey });

  const server = new McpServer(
    { name: "ailss-mcp", version: "0.1.0" },
    { instructions: PROMETHEUS_AGENT_INSTRUCTIONS },
  );

  server.prompt(
    "prometheus-agent",
    "Prometheus Agent: seed semantic search + expand typed links (2 hops).",
    {
      query: z.string().min(1).describe("User query"),
    },
    async ({ query }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "You are Prometheus Agent for the AILSS vault.",
                "Before answering, call `activate_context` with this query to gather context (seed semantic + 2-hop typed links).",
                "",
                query,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  // semantic_search tool
  server.tool(
    "semantic_search",
    {
      query: z.string().min(1),
      top_k: z.number().int().min(1).max(50).default(10),
    },
    async (args) => {
      const query = args.query;
      const top_k = args.top_k;
      const queryEmbedding = await embedQuery(client, embeddingModel, query);
      const results = semanticSearch(db, queryEmbedding, top_k);

      // Result shape: path, heading, distance, snippet
      const formatted = results.map((r) => ({
        path: r.path,
        heading: r.heading,
        heading_path: r.headingPath,
        distance: r.distance,
        snippet: r.content.slice(0, 300),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                top_k,
                db: dbPath,
                results: formatted,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // activate_context tool
  // - seed: semantic_search top1
  // - expand: typed links up to 2 hops (incoming + outgoing)
  server.tool(
    "activate_context",
    {
      query: z.string().min(1),
      max_hops: z.number().int().min(0).max(2).default(2),
      max_notes: z.number().int().min(1).max(50).default(25),
      max_chars_per_note: z.number().int().min(200).max(50_000).default(2000),
      max_links_per_note: z.number().int().min(1).max(200).default(40),
      max_resolutions_per_target: z.number().int().min(1).max(20).default(5),
      max_incoming_per_target: z.number().int().min(1).max(500).default(50),
    },
    async (args) => {
      const query = args.query;
      const maxHops = args.max_hops;
      const maxNotes = args.max_notes;
      const maxCharsPerNote = args.max_chars_per_note;

      const queryEmbedding = await embedQuery(client, embeddingModel, query);
      const seedHits = semanticSearch(db, queryEmbedding, 1);
      const seed = seedHits[0];
      if (!seed) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  seed: null,
                  activated: [],
                  note: "No indexed chunks found. Run the indexer first.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      type Via = {
        direction: "outgoing" | "incoming";
        rel: string;
        target: string;
        from_path: string;
        to_path: string;
      };

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
        const meta = getNoteMeta(db, notePath);
        metaCache.set(notePath, meta);
        return meta;
      };

      const readNotePreview = async (notePath: string): Promise<string | null> => {
        if (!vaultPath) return null;

        // Security: prevent path traversal outside the vault
        const abs = path.resolve(vaultPath, notePath);
        if (!abs.startsWith(path.resolve(vaultPath) + path.sep)) {
          throw new Error("Refusing to read a path outside the vault.");
        }

        const content = await fs.readFile(abs, "utf8");
        return content.length > maxCharsPerNote ? content.slice(0, maxCharsPerNote) : content;
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

      while (queue.length > 0 && activated.length < maxNotes) {
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

        if (node.hop >= maxHops) continue;
        if (!meta) continue;

        // Outgoing typed links
        for (const link of meta.typedLinks.slice(0, args.max_links_per_note)) {
          const resolved = resolveNotePathsByWikilinkTarget(
            db,
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
            if (activated.length + queue.length >= maxNotes) break;
          }
          if (activated.length + queue.length >= maxNotes) break;
        }

        // Incoming typed links (backrefs)
        const targets = guessWikilinkTargetsForNote(meta);
        for (const target of targets) {
          const backrefs = findNotesByTypedLink(db, {
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
            if (activated.length + queue.length >= maxNotes) break;
          }
          if (activated.length + queue.length >= maxNotes) break;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                seed: {
                  path: seed.path,
                  heading: seed.heading,
                  heading_path: seed.headingPath,
                  distance: seed.distance,
                  snippet: seed.content.slice(0, 300),
                },
                params: {
                  max_hops: maxHops,
                  max_notes: maxNotes,
                  max_chars_per_note: maxCharsPerNote,
                },
                activated,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // get_note tool
  server.tool(
    "get_note",
    {
      path: z.string().min(1),
      max_chars: z.number().int().min(200).max(200_000).default(20_000),
    },
    async (args) => {
      const notePath = args.path;
      const max_chars = args.max_chars;
      if (!vaultPath) {
        throw new Error("Cannot read files because AILSS_VAULT_PATH is not set.");
      }

      // Security: prevent path traversal outside the vault
      const abs = path.resolve(vaultPath, notePath);
      if (!abs.startsWith(path.resolve(vaultPath) + path.sep)) {
        throw new Error("Refusing to read a path outside the vault.");
      }

      const content = await fs.readFile(abs, "utf8");
      const sliced = content.length > max_chars ? content.slice(0, max_chars) : content;

      return {
        content: [
          {
            type: "text",
            text: sliced,
          },
        ],
      };
    },
  );

  // get_note_meta tool
  server.tool(
    "get_note_meta",
    {
      path: z.string().min(1),
    },
    async (args) => {
      const notePath = args.path;
      const meta = getNoteMeta(db, notePath);
      if (!meta) {
        throw new Error(
          `Note metadata not found for path="${notePath}". Re-run the indexer to populate frontmatter/typed links.`,
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(meta, null, 2),
          },
        ],
      };
    },
  );

  // search_notes tool
  server.tool(
    "search_notes",
    {
      path_prefix: z.string().min(1).optional(),
      title_query: z.string().min(1).optional(),
      entity: z.string().min(1).optional(),
      layer: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
      tags_any: z.array(z.string().min(1)).optional(),
      tags_all: z.array(z.string().min(1)).optional(),
      keywords_any: z.array(z.string().min(1)).optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async (args) => {
      const results = searchNotes(db, {
        limit: args.limit,
        ...(args.path_prefix ? { pathPrefix: args.path_prefix } : {}),
        ...(args.title_query ? { titleQuery: args.title_query } : {}),
        ...(args.entity ? { entity: args.entity } : {}),
        ...(args.layer ? { layer: args.layer } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.tags_any ? { tagsAny: args.tags_any } : {}),
        ...(args.tags_all ? { tagsAll: args.tags_all } : {}),
        ...(args.keywords_any ? { keywordsAny: args.keywords_any } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filters: args,
                db: dbPath,
                results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // find_notes_by_typed_link tool
  server.tool(
    "find_notes_by_typed_link",
    {
      rel: z.string().min(1).optional(),
      target: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(1000).default(200),
    },
    async (args) => {
      const toTarget = args.target ? normalizeTypedLinkTargetInput(args.target) : undefined;

      const results = findNotesByTypedLink(db, {
        limit: args.limit,
        ...(args.rel ? { rel: args.rel } : {}),
        ...(toTarget ? { toTarget } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: {
                  rel: args.rel,
                  target: args.target,
                  normalized_target: toTarget,
                  limit: args.limit,
                },
                db: dbPath,
                results,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
