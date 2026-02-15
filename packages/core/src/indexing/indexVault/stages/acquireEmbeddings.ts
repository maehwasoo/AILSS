import type { ChunkDiffPlan, IndexVaultOptions } from "../types.js";

function writeText(logger: IndexVaultOptions["logger"], text: string): void {
  logger?.write?.(text);
}

export async function acquireChunkEmbeddingsStage(
  options: IndexVaultOptions,
  plan: ChunkDiffPlan,
  batchSize: number,
): Promise<void> {
  for (let i = 0; i < plan.toEmbed.length; i += batchSize) {
    const batch = plan.toEmbed.slice(i, i + batchSize);
    const embeddings = await options.embedTexts(batch.map((chunk) => chunk.embeddingInput));

    for (const [j, chunk] of batch.entries()) {
      const embedding = embeddings[j];
      if (!embedding) {
        throw new Error(
          `Embedding response returned too few embeddings. batchSize=${batch.length}, got=${embeddings.length}`,
        );
      }
      plan.embeddingByInputSha.set(chunk.embeddingInputSha256, embedding);
    }

    writeText(
      options.logger,
      `[chunks] ${Math.min(i + batch.length, plan.toEmbed.length)}/${plan.toEmbed.length}\r`,
    );
  }

  writeText(options.logger, "\n");
}
