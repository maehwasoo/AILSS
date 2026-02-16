import type { AilssDb } from "../../db/db.js";
import type { statMarkdownFile } from "../../vault/filesystem.js";

export type IndexVaultSummary = {
  changedFiles: number;
  indexedChunks: number;
  deletedFiles: number;
};

export type IndexVaultLogger = {
  log?: (line: string) => void;
  write?: (text: string) => void;
};

export type IndexVaultOptions = {
  db: AilssDb;
  vaultPath: string;
  dbPathForLog?: string;
  embeddingModel: string;
  embedTexts: (inputs: string[]) => Promise<number[][]>;
  paths?: string[];
  maxChars?: number;
  batchSize?: number;
  logger?: IndexVaultLogger;
};

export type PlannedChunk = {
  chunkId: string;
  content: string;
  contentSha256: string;
  embeddingInput: string;
  embeddingInputSha256: string;
  chunkIndex: number;
  heading: string | null;
  headingPathJson: string;
};

export type EmbeddingInputMeta = {
  title: string;
  summary: string;
};

export type IndexedMarkdownFile = Awaited<ReturnType<typeof statMarkdownFile>>;

export type ResolvedIndexTargets = {
  requestedPaths: string[];
  absPaths: string[];
  existingRelPaths: Set<string> | null;
  isFullVaultRun: boolean;
  deletedFiles: number;
};

export type SyncedFileMetadata = {
  body: string;
  embeddingInputMeta: EmbeddingInputMeta;
};

export type ChunkDiffPlan = {
  plannedChunks: PlannedChunk[];
  existingChunkIdsAfterDelete: Set<string>;
  toDelete: string[];
  embeddingByInputSha: Map<string, number[]>;
  toEmbed: Array<{ embeddingInputSha256: string; embeddingInput: string }>;
};
