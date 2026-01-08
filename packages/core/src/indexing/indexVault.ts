import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { AilssDb } from "../db/db.js";
import {
  deleteChunksByPath,
  deleteFileByPath,
  getFileSha256,
  insertChunkWithEmbedding,
  listFilePaths,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  upsertFile,
  upsertNote,
} from "../db/db.js";
import { normalizeAilssNoteMeta } from "../vault/frontmatter.js";
import {
  chunkMarkdownByHeadings,
  extractWikilinkTypedLinksFromMarkdownBody,
  parseMarkdownNote,
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
    const bodyLinks = extractWikilinkTypedLinksFromMarkdownBody(parsed.body);

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
      viewed: noteMeta.viewed,
      frontmatterJson: JSON.stringify(noteMeta.frontmatter),
    });
    replaceNoteTags(options.db, file.relPath, noteMeta.tags);
    replaceNoteKeywords(options.db, file.relPath, noteMeta.keywords);
    replaceTypedLinks(options.db, file.relPath, [...noteMeta.typedLinks, ...bodyLinks]);

    if (!needsEmbeddingUpdate) {
      continue;
    }

    deleteChunksByPath(options.db, file.relPath);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const embeddings = await options.embedTexts(batch.map((c) => c.content));

      for (const [j, chunk] of batch.entries()) {
        const embedding = embeddings[j];
        if (!embedding) {
          throw new Error(
            `Embedding response returned too few embeddings. batchSize=${batch.length}, got=${embeddings.length}`,
          );
        }

        const chunkOrdinal = i + j;
        const chunkId = sha256Text(
          `${file.relPath}\n${chunkOrdinal}\n${JSON.stringify(chunk.headingPath)}\n${chunk.contentSha256}`,
        );

        insertChunkWithEmbedding(options.db, {
          chunkId,
          path: file.relPath,
          heading: chunk.heading,
          headingPathJson: JSON.stringify(chunk.headingPath),
          content: chunk.content,
          contentSha256: chunk.contentSha256,
          embedding,
        });
        indexedChunks += 1;
      }

      writeText(
        options.logger,
        `[chunks] ${Math.min(i + batch.length, chunks.length)}/${chunks.length}\r`,
      );
    }

    writeText(options.logger, "\n");
    logLine(options.logger, `[done] chunks=${chunks.length}`);
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
