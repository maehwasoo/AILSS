import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { AilssDb } from "../db/db.js";
import {
  deleteChunksByIds,
  deleteFileByPath,
  getFileSha256,
  listChunkEmbeddingsByPath,
  listChunkIdsByPath,
  insertChunkWithEmbedding,
  listFilePaths,
  replaceNoteSources,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  upsertFile,
  upsertNote,
  updateChunkMetadata,
} from "../db/db.js";
import { normalizeAilssNoteMeta } from "../vault/frontmatter.js";
import {
  chunkMarkdownByHeadings,
  parseMarkdownNote,
  type MarkdownChunk,
} from "../vault/markdown.js";
import {
  isDefaultIgnoredVaultRelPath,
  listMarkdownFiles,
  readUtf8File,
  statMarkdownFile,
} from "../vault/filesystem.js";

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

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function logLine(logger: IndexVaultLogger | undefined, line: string): void {
  logger?.log?.(line);
}

function writeText(logger: IndexVaultLogger | undefined, text: string): void {
  logger?.write?.(text);
}

type PlannedChunk = {
  chunkId: string;
  content: string;
  contentSha256: string;
  embeddingInput: string;
  embeddingInputSha256: string;
  chunkIndex: number;
  heading: string | null;
  headingPathJson: string;
};

type EmbeddingInputMeta = {
  title: string;
  summary: string;
};

function buildChunkEmbeddingInput(
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

function computeStableChunkIds(
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

type IndexedMarkdownFile = Awaited<ReturnType<typeof statMarkdownFile>>;

type ResolvedIndexTargets = {
  requestedPaths: string[];
  absPaths: string[];
  existingRelPaths: Set<string> | null;
  isFullVaultRun: boolean;
  deletedFiles: number;
};

async function resolveIndexTargetsStage(options: IndexVaultOptions): Promise<ResolvedIndexTargets> {
  const requestedPaths = (options.paths ?? []).map((p) => p.trim()).filter(Boolean);
  const absPaths: string[] = [];
  const isFullVaultRun = requestedPaths.length === 0;
  let deletedFiles = 0;

  if (!isFullVaultRun) {
    const vaultRoot = path.resolve(options.vaultPath);
    const seenAbsPaths = new Set<string>();

    for (const inputPath of requestedPaths) {
      const candidateAbs = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(options.vaultPath, inputPath);

      if (!candidateAbs.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Refusing to index a path outside the vault: ${inputPath}`);
      }

      if (!candidateAbs.toLowerCase().endsWith(".md")) continue;

      const relPath = relPathFromAbs(options.vaultPath, candidateAbs);
      if (isDefaultIgnoredVaultRelPath(relPath)) continue;

      try {
        await fs.stat(candidateAbs);
        if (seenAbsPaths.has(candidateAbs)) continue;
        seenAbsPaths.add(candidateAbs);
        absPaths.push(candidateAbs);
      } catch {
        deleteFileByPath(options.db, relPath);
        deletedFiles += 1;
      }
    }
  } else {
    absPaths.push(...(await listMarkdownFiles(options.vaultPath)));
  }

  return {
    requestedPaths,
    absPaths,
    existingRelPaths: isFullVaultRun
      ? new Set(absPaths.map((absPath) => relPathFromAbs(options.vaultPath, absPath)))
      : null,
    isFullVaultRun,
    deletedFiles,
  };
}

type SyncedFileMetadata = {
  body: string;
  embeddingInputMeta: EmbeddingInputMeta;
};

async function syncFileMetadataStage(
  options: IndexVaultOptions,
  file: IndexedMarkdownFile,
): Promise<SyncedFileMetadata> {
  const markdown = await readUtf8File(file.absPath);
  const parsed = parseMarkdownNote(markdown);
  const noteMeta = normalizeAilssNoteMeta(parsed.frontmatter);

  upsertFile(options.db, {
    path: file.relPath,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.size,
    sha256: file.sha256,
  });

  upsertNote(options.db, {
    path: file.relPath,
    noteId: noteMeta.noteId,
    created: noteMeta.created,
    title: noteMeta.title,
    summary: noteMeta.summary,
    entity: noteMeta.entity,
    layer: noteMeta.layer,
    status: noteMeta.status,
    updated: noteMeta.updated,
    frontmatterJson: JSON.stringify(noteMeta.frontmatter),
  });
  replaceNoteTags(options.db, file.relPath, noteMeta.tags);
  replaceNoteKeywords(options.db, file.relPath, noteMeta.keywords);
  replaceNoteSources(options.db, file.relPath, noteMeta.sources);
  replaceTypedLinks(options.db, file.relPath, noteMeta.typedLinks);

  return {
    body: parsed.body,
    embeddingInputMeta: {
      title: noteMeta.title ?? "",
      summary: noteMeta.summary ?? "",
    },
  };
}

type ChunkDiffPlan = {
  plannedChunks: PlannedChunk[];
  existingChunkIdsAfterDelete: Set<string>;
  toDelete: string[];
  embeddingByInputSha: Map<string, number[]>;
  toEmbed: Array<{ embeddingInputSha256: string; embeddingInput: string }>;
};

function planChunkDiffStage(
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

function applyChunkDeleteStage(db: AilssDb, toDelete: string[]): void {
  if (toDelete.length === 0) return;
  deleteChunksByIds(db, toDelete);
}

async function acquireChunkEmbeddingsStage(
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

function applyChunkWriteStage(
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
