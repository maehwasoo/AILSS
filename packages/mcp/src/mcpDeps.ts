// Shared dependency container for MCP tool registration

import type { AilssDb } from "@ailss/core";
import type OpenAI from "openai";

export type McpToolDeps = {
  db: AilssDb;
  dbPath: string;
  vaultPath: string | undefined;
  openai: OpenAI;
  embeddingModel: string;
};
