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
  heading: string | null;
  headingPathJson: string;
};

function computeStableChunkIds(fileRelPath: string, chunks: MarkdownChunk[]): PlannedChunk[] {
  // Stable IDs across edits
  // - based on chunk content hash, not global ordinal
  // - include an occurrence index to disambiguate duplicates within the same file
  const occurrenceByContent = new Map<string, number>();

  return chunks.map((chunk) => {
    const contentKey = chunk.contentSha256;
    const occurrence = occurrenceByContent.get(contentKey) ?? 0;
    occurrenceByContent.set(contentKey, occurrence + 1);

    const chunkId = sha256Text(`${fileRelPath}\n${contentKey}\n${occurrence}`);
    return {
      chunkId,
      content: chunk.content,
      contentSha256: chunk.contentSha256,
      heading: chunk.heading,
      headingPathJson: JSON.stringify(chunk.headingPath),
    };
  });
}

export async function indexVault(options: IndexVaultOptions): Promise<IndexVaultSummary> {
  const maxChars = Math.max(1, options.maxChars ?? 4000);
  const batchSize = Math.max(1, options.batchSize ?? 32);

  const requestedPaths = (options.paths ?? []).map((p) => p.trim()).filter(Boolean);
  const absPaths: string[] = [];
  let deletedFiles = 0;

  if (requestedPaths.length > 0) {
    const vaultRoot = path.resolve(options.vaultPath);
    const seenAbsPaths = new Set<string>();

    for (const inputPath of requestedPaths) {
      const candidateAbs = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(options.vaultPath, inputPath);

      if (!candidateAbs.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Refusing to index a path outside the vault: ${inputPath}`);
      }

      if (!candidateAbs.toLowerCase().endsWith(".md")) {
        continue;
      }

      const relPath = relPathFromAbs(options.vaultPath, candidateAbs);
      if (isDefaultIgnoredVaultRelPath(relPath)) {
        continue;
      }

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

  const existingRelPaths =
    requestedPaths.length > 0
      ? null
      : new Set(absPaths.map((absPath) => relPathFromAbs(options.vaultPath, absPath)));

  logLine(options.logger, `[ailss-indexer] vault=${options.vaultPath}`);
  logLine(options.logger, `[ailss-indexer] db=${options.dbPathForLog ?? "<in-process>"}`);
  logLine(options.logger, `[ailss-indexer] files=${absPaths.length}`);

  let changedFiles = 0;
  let indexedChunks = 0;

  for (const absPath of absPaths) {
    const file = await statMarkdownFile(options.vaultPath, absPath);
    const prevSha = getFileSha256(options.db, file.relPath);

    const shaUnchanged = !!prevSha && prevSha === file.sha256;
    const isFullVaultRun = requestedPaths.length === 0;

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

    const markdown = await readUtf8File(file.absPath);
    const parsed = parseMarkdownNote(markdown);
    const chunks = needsEmbeddingUpdate ? chunkMarkdownByHeadings(parsed.body, { maxChars }) : [];
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

    if (!needsEmbeddingUpdate) {
      continue;
    }

    const plannedChunks = computeStableChunkIds(file.relPath, chunks);

    const existingChunkIds = new Set(listChunkIdsByPath(options.db, file.relPath));
    const nextChunkIds = new Set(plannedChunks.map((c) => c.chunkId));

    const toDelete: string[] = [];
    for (const chunkId of existingChunkIds) {
      if (!nextChunkIds.has(chunkId)) toDelete.push(chunkId);
    }

    // Embedding cache by content hash
    // - allows per-chunk reuse even when chunk IDs change (e.g. heading rename)
    const embeddingByContentSha = new Map<string, number[]>();
    for (const item of listChunkEmbeddingsByPath(options.db, file.relPath)) {
      if (!embeddingByContentSha.has(item.contentSha256)) {
        embeddingByContentSha.set(item.contentSha256, item.embedding);
      }
    }

    // Plan which new chunk contents need embedding calls (deduped)
    const toEmbed: Array<{ contentSha256: string; content: string }> = [];
    const seenToEmbed = new Set<string>();
    for (const planned of plannedChunks) {
      if (existingChunkIds.has(planned.chunkId)) continue;
      if (embeddingByContentSha.has(planned.contentSha256)) continue;
      if (seenToEmbed.has(planned.contentSha256)) continue;
      seenToEmbed.add(planned.contentSha256);
      toEmbed.push({ contentSha256: planned.contentSha256, content: planned.content });
    }

    if (toDelete.length > 0) {
      deleteChunksByIds(options.db, toDelete);
    }

    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const embeddings = await options.embedTexts(batch.map((c) => c.content));

      for (const [j, chunk] of batch.entries()) {
        const embedding = embeddings[j];
        if (!embedding) {
          throw new Error(
            `Embedding response returned too few embeddings. batchSize=${batch.length}, got=${embeddings.length}`,
          );
        }
        embeddingByContentSha.set(chunk.contentSha256, embedding);
      }

      writeText(
        options.logger,
        `[chunks] ${Math.min(i + batch.length, toEmbed.length)}/${toEmbed.length}\r`,
      );
    }

    writeText(options.logger, "\n");

    // Update existing chunk metadata without touching embeddings
    for (const planned of plannedChunks) {
      if (!existingChunkIds.has(planned.chunkId)) continue;
      updateChunkMetadata(options.db, {
        chunkId: planned.chunkId,
        path: file.relPath,
        heading: planned.heading,
        headingPathJson: planned.headingPathJson,
        content: planned.content,
        contentSha256: planned.contentSha256,
      });
    }

    // Insert new chunks with embeddings (reused or freshly embedded)
    for (const planned of plannedChunks) {
      if (existingChunkIds.has(planned.chunkId)) continue;
      const embedding = embeddingByContentSha.get(planned.contentSha256);
      if (!embedding) {
        throw new Error(
          `Missing embedding for chunk insertion. path=${file.relPath}, contentSha256=${planned.contentSha256}`,
        );
      }

      insertChunkWithEmbedding(options.db, {
        chunkId: planned.chunkId,
        path: file.relPath,
        heading: planned.heading,
        headingPathJson: planned.headingPathJson,
        content: planned.content,
        contentSha256: planned.contentSha256,
        embedding,
      });
    }

    indexedChunks += plannedChunks.length;
    logLine(options.logger, `[done] chunks=${plannedChunks.length}`);
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
