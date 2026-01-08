import type OpenAI from "openai";

import type { IndexVaultSummary } from "@ailss/core";
import { indexVault } from "@ailss/core";

import type { McpToolDeps } from "../mcpDeps.js";

async function embedTexts(client: OpenAI, model: string, inputs: string[]): Promise<number[][]> {
  const resp = await client.embeddings.create({
    model,
    input: inputs,
    encoding_format: "float",
  });

  return resp.data.map((d) => d.embedding as number[]);
}

export async function reindexVaultPaths(
  deps: McpToolDeps,
  paths: string[],
  options: { maxChars?: number; batchSize?: number } = {},
): Promise<IndexVaultSummary> {
  if (!deps.vaultPath) {
    throw new Error("Cannot reindex because AILSS_VAULT_PATH is not set.");
  }

  return await indexVault({
    db: deps.db,
    dbPathForLog: deps.dbPath,
    vaultPath: deps.vaultPath,
    embeddingModel: deps.embeddingModel,
    embedTexts: (inputs) => embedTexts(deps.openai, deps.embeddingModel, inputs),
    paths,
    ...(options.maxChars ? { maxChars: options.maxChars } : {}),
    ...(options.batchSize ? { batchSize: options.batchSize } : {}),
  });
}
