import { insertChunkWithEmbedding, updateChunkMetadata } from "../../../db/db.js";

import type { ChunkDiffPlan, IndexVaultOptions } from "../types.js";

export function applyChunkWriteStage(
  options: IndexVaultOptions,
  fileRelPath: string,
  plan: ChunkDiffPlan,
): void {
  for (const planned of plan.plannedChunks) {
    if (!plan.existingChunkIdsAfterDelete.has(planned.chunkId)) continue;
    updateChunkMetadata(options.db, {
      chunkId: planned.chunkId,
      path: fileRelPath,
      chunkIndex: planned.chunkIndex,
      heading: planned.heading,
      headingPathJson: planned.headingPathJson,
      content: planned.content,
      contentSha256: planned.contentSha256,
      embeddingInputSha256: planned.embeddingInputSha256,
    });
  }

  for (const planned of plan.plannedChunks) {
    if (plan.existingChunkIdsAfterDelete.has(planned.chunkId)) continue;
    const embedding = plan.embeddingByInputSha.get(planned.embeddingInputSha256);
    if (!embedding) {
      throw new Error(
        `Missing embedding for chunk insertion. path=${fileRelPath}, embeddingInputSha256=${planned.embeddingInputSha256}`,
      );
    }

    insertChunkWithEmbedding(options.db, {
      chunkId: planned.chunkId,
      path: fileRelPath,
      chunkIndex: planned.chunkIndex,
      heading: planned.heading,
      headingPathJson: planned.headingPathJson,
      content: planned.content,
      contentSha256: planned.contentSha256,
      embeddingInputSha256: planned.embeddingInputSha256,
      embedding,
    });
  }
}
