import type OpenAI from "openai";

import type { AilssDb, IndexVaultLogger, IndexVaultSummary } from "@ailss/core";
import { indexVault as indexVaultCore } from "@ailss/core";

export type IndexVaultOptions = {
  db: AilssDb;
  dbPath: string;
  vaultPath: string;
  openai: OpenAI;
  embeddingModel: string;
  maxChars: number;
  batchSize: number;
  paths?: string[];
  logger?: IndexVaultLogger;
};

async function embedTexts(client: OpenAI, model: string, inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const resp = await client.embeddings.create({
    model,
    input: inputs,
    encoding_format: "float",
  });

  const data = (resp as unknown as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("OpenAI embeddings.create returned invalid response: data is not an array");
  }

  if (data.length !== inputs.length) {
    throw new Error(
      `OpenAI embeddings.create returned ${data.length} embeddings for ${inputs.length} inputs`,
    );
  }

  return data.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(
        `OpenAI embeddings.create returned invalid embedding at index ${index}: expected object`,
      );
    }

    const embedding = (item as { embedding?: unknown }).embedding;
    if (!Array.isArray(embedding) || embedding.some((v) => typeof v !== "number")) {
      throw new Error(
        `OpenAI embeddings.create returned invalid embedding at index ${index}: expected number[]`,
      );
    }

    return embedding as number[];
  });
}

export async function indexVault(options: IndexVaultOptions): Promise<IndexVaultSummary> {
  const paths = options.paths && options.paths.length > 0 ? options.paths : undefined;

  return await indexVaultCore({
    db: options.db,
    dbPathForLog: options.dbPath,
    vaultPath: options.vaultPath,
    embeddingModel: options.embeddingModel,
    embedTexts: (inputs) => embedTexts(options.openai, options.embeddingModel, inputs),
    ...(paths ? { paths } : {}),
    maxChars: options.maxChars,
    batchSize: options.batchSize,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
