// Environment variable loading utilities
// - shared by indexer and mcp

import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

export type AilssEnv = {
  openaiApiKey: string | undefined;
  openaiEmbeddingModel: string;
  enableWriteTools: boolean;
  vaultPath: string | undefined;
  neo4jEnabled: boolean;
  neo4jUri: string | undefined;
  neo4jUsername: string | undefined;
  neo4jPassword: string | undefined;
  neo4jDatabase: string;
  neo4jSyncOnIndex: boolean;
  neo4jStrictMode: boolean;
};

function findNearestEnvFile(startDir: string): string | null {
  // Repo-root .env discovery
  // - supports running from package subdirectories (pnpm -C)
  let current = path.resolve(startDir);

  // Stop at filesystem root
  while (true) {
    const candidate = path.join(current, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function loadEnv(): AilssEnv {
  // .env is for local convenience; production can run with env vars only
  const envPath = findNearestEnvFile(process.cwd());
  if (envPath) {
    loadDotenv({ path: envPath, quiet: true });
  } else {
    loadDotenv({ quiet: true });
  }

  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
    enableWriteTools: process.env.AILSS_ENABLE_WRITE_TOOLS === "1",
    vaultPath: process.env.AILSS_VAULT_PATH,
    neo4jEnabled: process.env.AILSS_NEO4J_ENABLED === "1",
    neo4jUri: process.env.AILSS_NEO4J_URI,
    neo4jUsername: process.env.AILSS_NEO4J_USERNAME,
    neo4jPassword: process.env.AILSS_NEO4J_PASSWORD,
    neo4jDatabase: process.env.AILSS_NEO4J_DATABASE ?? "neo4j",
    neo4jSyncOnIndex: process.env.AILSS_NEO4J_SYNC_ON_INDEX !== "0",
    neo4jStrictMode: process.env.AILSS_NEO4J_STRICT_MODE === "1",
  };
}
