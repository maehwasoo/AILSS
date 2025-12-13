// 환경변수(environment variable) 로딩 유틸
// - indexer, mcp 양쪽에서 공통으로 사용

import { config as loadDotenv } from "dotenv";

export type AilssEnv = {
  openaiApiKey: string | undefined;
  openaiEmbeddingModel: string;
  vaultPath: string | undefined;
};

export function loadEnv(): AilssEnv {
  // .env는 개발 편의용, 운영에서는 환경변수만으로도 동작
  loadDotenv();

  return {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    vaultPath: process.env.AILSS_VAULT_PATH,
  };
}

