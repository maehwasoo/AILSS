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
  const resp = await client.embeddings.create({
    model,
    input: inputs,
    encoding_format: "float",
  });

  return resp.data.map((d) => d.embedding as number[]);
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
