import { createHash } from "node:crypto";

import type { MarkdownChunk } from "../../vault/markdown.js";

import type { EmbeddingInputMeta, PlannedChunk } from "./types.js";

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildChunkEmbeddingInput(
  meta: EmbeddingInputMeta,
  chunk: Pick<MarkdownChunk, "content" | "headingPath">,
): string {
  const headingPath = chunk.headingPath.join(" > ");
  return [
    `Title: ${meta.title}`,
    `Summary: ${meta.summary}`,
    `Heading path: ${headingPath}`,
    "---",
    chunk.content,
  ].join("\n");
}

export function computeStableChunkIds(
  fileRelPath: string,
  chunks: MarkdownChunk[],
  embeddingInputMeta: EmbeddingInputMeta,
): PlannedChunk[] {
  // Stable IDs across edits
  // - based on chunk content hash, not global ordinal
  // - include an occurrence index to disambiguate duplicates within the same file
  const occurrenceByContent = new Map<string, number>();

  return chunks.map((chunk, chunkIndex) => {
    const contentKey = chunk.contentSha256;
    const occurrence = occurrenceByContent.get(contentKey) ?? 0;
    occurrenceByContent.set(contentKey, occurrence + 1);

    const chunkId = sha256Text(`${fileRelPath}\n${contentKey}\n${occurrence}`);
    const embeddingInput = buildChunkEmbeddingInput(embeddingInputMeta, chunk);
    const embeddingInputSha256 = sha256Text(embeddingInput);
    return {
      chunkId,
      content: chunk.content,
      contentSha256: chunk.contentSha256,
      embeddingInput,
      embeddingInputSha256,
      chunkIndex,
      heading: chunk.heading,
      headingPathJson: JSON.stringify(chunk.headingPath),
    };
  });
}
