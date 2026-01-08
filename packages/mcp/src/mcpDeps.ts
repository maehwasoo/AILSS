// Shared dependency container for MCP tool registration

import type { AilssDb } from "@ailss/core";
import type OpenAI from "openai";

export type WriteLock = {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
};

export type McpToolDeps = {
  db: AilssDb;
  dbPath: string;
  vaultPath: string | undefined;
  openai: OpenAI;
  embeddingModel: string;
  writeLock?: WriteLock;
};
