import type { AilssDb } from "../../../db/db.js";
import { listChunkEmbeddingsByPath, listChunkIdsByPath } from "../../../db/db.js";
import { chunkMarkdownByHeadings } from "../../../vault/markdown.js";

import { computeStableChunkIds } from "../chunkIds.js";
import type { ChunkDiffPlan, EmbeddingInputMeta } from "../types.js";

export function planChunkDiffStage(
  db: AilssDb,
  fileRelPath: string,
  body: string,
  maxChars: number,
  embeddingInputMeta: EmbeddingInputMeta,
): ChunkDiffPlan {
  const chunks = chunkMarkdownByHeadings(body, { maxChars });
  const plannedChunks = computeStableChunkIds(fileRelPath, chunks, embeddingInputMeta);

  const existingChunkIds = new Set(listChunkIdsByPath(db, fileRelPath));
  const nextChunkIds = new Set(plannedChunks.map((chunk) => chunk.chunkId));

  const toDeleteSet = new Set<string>();
  for (const chunkId of existingChunkIds) {
    if (!nextChunkIds.has(chunkId)) toDeleteSet.add(chunkId);
  }

  const existingEmbeddingInputShaByChunkId = new Map<string, string>();
  const embeddingByInputSha = new Map<string, number[]>();
  for (const item of listChunkEmbeddingsByPath(db, fileRelPath)) {
    existingEmbeddingInputShaByChunkId.set(item.chunkId, item.embeddingInputSha256);
    if (!item.embeddingInputSha256) continue;
    if (!item.embedding) continue;
    if (embeddingByInputSha.has(item.embeddingInputSha256)) continue;
    embeddingByInputSha.set(item.embeddingInputSha256, item.embedding);
  }

  // Existing chunk IDs that require re-embedding due to embedding-input change.
  for (const planned of plannedChunks) {
    if (!existingChunkIds.has(planned.chunkId)) continue;
    const existingInputSha = existingEmbeddingInputShaByChunkId.get(planned.chunkId) ?? "";
    if (existingInputSha === planned.embeddingInputSha256) continue;
    toDeleteSet.add(planned.chunkId);
  }

  const toDelete = Array.from(toDeleteSet);
  const existingChunkIdsAfterDelete = new Set(
    Array.from(existingChunkIds).filter((chunkId) => !toDeleteSet.has(chunkId)),
  );

  const toEmbed: Array<{ embeddingInputSha256: string; embeddingInput: string }> = [];
  const seenToEmbed = new Set<string>();
  for (const planned of plannedChunks) {
    if (existingChunkIdsAfterDelete.has(planned.chunkId)) continue;
    if (embeddingByInputSha.has(planned.embeddingInputSha256)) continue;
    if (seenToEmbed.has(planned.embeddingInputSha256)) continue;
    seenToEmbed.add(planned.embeddingInputSha256);
    toEmbed.push({
      embeddingInputSha256: planned.embeddingInputSha256,
      embeddingInput: planned.embeddingInput,
    });
  }

  return {
    plannedChunks,
    existingChunkIdsAfterDelete,
    toDelete,
    embeddingByInputSha,
    toEmbed,
  };
}
