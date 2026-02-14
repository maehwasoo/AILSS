import { deleteFileByPath, getFileSha256, listFilePaths } from "../db/db.js";
import { statMarkdownFile } from "../vault/filesystem.js";

import { applyChunkDeleteStage } from "./indexVault/stages/applyDeletes.js";
import { acquireChunkEmbeddingsStage } from "./indexVault/stages/acquireEmbeddings.js";
import { applyChunkWriteStage } from "./indexVault/stages/applyWrites.js";
import { planChunkDiffStage } from "./indexVault/stages/planChunkDiff.js";
import { resolveIndexTargetsStage } from "./indexVault/stages/resolveTargets.js";
import { syncFileMetadataStage } from "./indexVault/stages/syncMetadata.js";

import type { IndexVaultOptions, IndexVaultSummary } from "./indexVault/types.js";

export type { IndexVaultLogger, IndexVaultOptions, IndexVaultSummary } from "./indexVault/types.js";

function logLine(logger: IndexVaultOptions["logger"], line: string): void {
  logger?.log?.(line);
}

export async function indexVault(options: IndexVaultOptions): Promise<IndexVaultSummary> {
  const maxChars = Math.max(1, options.maxChars ?? 4000);
  const batchSize = Math.max(1, options.batchSize ?? 32);

  const targets = await resolveIndexTargetsStage(options);
  const { absPaths, existingRelPaths, isFullVaultRun } = targets;
  let deletedFiles = targets.deletedFiles;

  logLine(options.logger, `[ailss-indexer] vault=${options.vaultPath}`);
  logLine(options.logger, `[ailss-indexer] db=${options.dbPathForLog ?? "<in-process>"}`);
  logLine(options.logger, `[ailss-indexer] files=${absPaths.length}`);

  let changedFiles = 0;
  let indexedChunks = 0;

  for (const absPath of absPaths) {
    const file = await statMarkdownFile(options.vaultPath, absPath);
    const prevSha = getFileSha256(options.db, file.relPath);

    const shaUnchanged = !!prevSha && prevSha === file.sha256;

    if (shaUnchanged && !isFullVaultRun) continue;

    const needsEmbeddingUpdate = !shaUnchanged;
    if (needsEmbeddingUpdate) {
      changedFiles += 1;
      logLine(options.logger, "");
      logLine(options.logger, `[index] ${file.relPath}`);
    } else {
      logLine(options.logger, "");
      logLine(options.logger, `[meta] ${file.relPath}`);
    }

    const synced = await syncFileMetadataStage(options, file);

    if (!needsEmbeddingUpdate) {
      continue;
    }

    const plan = planChunkDiffStage(
      options.db,
      file.relPath,
      synced.body,
      maxChars,
      synced.embeddingInputMeta,
    );
    applyChunkDeleteStage(options.db, plan.toDelete);
    await acquireChunkEmbeddingsStage(options, plan, batchSize);
    applyChunkWriteStage(options, file.relPath, plan);

    indexedChunks += plan.plannedChunks.length;
    logLine(options.logger, `[done] chunks=${plan.plannedChunks.length}`);
  }

  if (existingRelPaths) {
    for (const indexedPath of listFilePaths(options.db)) {
      if (existingRelPaths.has(indexedPath)) continue;
      deleteFileByPath(options.db, indexedPath);
      deletedFiles += 1;
    }
  }

  logLine(options.logger, "");
  logLine(
    options.logger,
    `[summary] changedFiles=${changedFiles}, indexedChunks=${indexedChunks}, deletedFiles=${deletedFiles}`,
  );

  return { changedFiles, indexedChunks, deletedFiles };
}
