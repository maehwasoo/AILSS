// Environment variable loading utilities
// - shared by indexer and mcp

import { config as loadDotenv } from "dotenv";

export type AilssEnv = {
  openaiApiKey: string | undefined;
  openaiEmbeddingModel: string;
  vaultPath: string | undefined;
};

export function loadEnv(): AilssEnv {
  // .env is for local convenience; production can run with env vars only
  loadDotenv();

  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    vaultPath: process.env.AILSS_VAULT_PATH,
  };
}
