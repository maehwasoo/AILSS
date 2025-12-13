#!/usr/bin/env node
// AILSS MCP 서버(server) - STDIO transport
// - semantic_search, get_note 등 읽기 중심 도구(tool) 제공

import OpenAI from "openai";
import { z } from "zod";

import {
  loadEnv,
  openAilssDb,
  resolveDefaultDbPath,
  semanticSearch,
} from "@ailss/core";

import { promises as fs } from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
    throw new Error("DB 경로가 없어요. AILSS_VAULT_PATH 또는 AILSS_DB_PATH를 설정해요.");
  }

  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY가 없어요. .env 또는 환경변수로 설정해요.");
  }

  const db = openAilssDb({ dbPath, embeddingDim });
  const client = new OpenAI({ apiKey: openaiApiKey });

  const server = new McpServer({ name: "ailss-mcp", version: "0.1.0" });

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

      // 결과 포맷: 경로(path), 헤딩(heading), 거리(distance), 스니펫(snippet)
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
        throw new Error("AILSS_VAULT_PATH가 없어서 파일을 읽을 수 없어요.");
      }

      // 보안: vault 밖 경로 접근 방지
      const abs = path.resolve(vaultPath, notePath);
      if (!abs.startsWith(path.resolve(vaultPath) + path.sep)) {
        throw new Error("vault 밖 경로는 읽을 수 없어요.");
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

await main();
