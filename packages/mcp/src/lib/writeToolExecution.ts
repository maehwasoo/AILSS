// Shared write-tool execution helpers

import type { McpToolDeps, WriteLock } from "../mcpDeps.js";
import { reindexVaultPaths } from "./reindexVaultPaths.js";

type ReindexSummary = {
  changed_files: number;
  indexed_chunks: number;
  deleted_files: number;
};

export type ApplyAndOptionalReindexResult = {
  applied: boolean;
  needs_reindex: boolean;
  reindexed: boolean;
  reindex_summary: ReindexSummary | null;
  reindex_error: string | null;
};

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runWithOptionalWriteLock<T>(options: {
  apply: boolean;
  writeLock: WriteLock | undefined;
  run: () => Promise<T>;
}): Promise<T> {
  if (!options.apply) return await options.run();
  return await (options.writeLock ? options.writeLock.runExclusive(options.run) : options.run());
}

export async function applyAndOptionalReindex(options: {
  deps: McpToolDeps;
  apply: boolean;
  changed: boolean;
  reindexAfterApply: boolean;
  reindexPaths: string[];
  applyWrite: () => Promise<void>;
}): Promise<ApplyAndOptionalReindexResult> {
  const applied = Boolean(options.apply && options.changed);
  if (!applied) {
    return {
      applied: false,
      needs_reindex: false,
      reindexed: false,
      reindex_summary: null,
      reindex_error: null,
    };
  }

  await options.applyWrite();

  if (!options.reindexAfterApply) {
    return {
      applied: true,
      needs_reindex: true,
      reindexed: false,
      reindex_summary: null,
      reindex_error: null,
    };
  }

  try {
    const summary = await reindexVaultPaths(options.deps, options.reindexPaths);
    return {
      applied: true,
      needs_reindex: false,
      reindexed: true,
      reindex_summary: {
        changed_files: summary.changedFiles,
        indexed_chunks: summary.indexedChunks,
        deleted_files: summary.deletedFiles,
      },
      reindex_error: null,
    };
  } catch (error) {
    return {
      applied: true,
      needs_reindex: true,
      reindexed: false,
      reindex_summary: null,
      reindex_error: errorToMessage(error),
    };
  }
}
