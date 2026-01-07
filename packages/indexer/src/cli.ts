#!/usr/bin/env node
// AILSS indexer CLI
// - vault → chunking → embeddings → SQLite(vec) storage

import { Command } from "commander";
import OpenAI from "openai";

import {
  chunkMarkdownByHeadings,
  deleteFileByPath,
  extractWikilinkTypedLinksFromMarkdownBody,
  getFileSha256,
  normalizeAilssNoteMeta,
  insertChunkWithEmbedding,
  listFilePaths,
  listMarkdownFiles,
  loadEnv,
  openAilssDb,
  parseMarkdownNote,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  resolveDefaultDbPath,
  statMarkdownFile,
  upsertFile,
  upsertNote,
  deleteChunksByPath,
  readUtf8File,
} from "@ailss/core";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type IndexCommandOptions = {
  vault?: string;
  db?: string;
  model?: string;
  paths?: string[];
  resetDb?: boolean;
  maxChars: number;
  batchSize: number;
};

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function embeddingDimForModel(model: string): number {
  // OpenAI embeddings v3 default dimensions
  // - If the caller sets a custom `dimensions`, this may differ; for now we use model defaults
  if (model === "text-embedding-3-large") return 3072;
  return 1536;
}

async function createOpenAiClient(apiKey: string): Promise<OpenAI> {
  return new OpenAI({ apiKey });
}

async function embedTexts(client: OpenAI, model: string, inputs: string[]): Promise<number[][]> {
  const resp = await client.embeddings.create({
    model,
    input: inputs,
    encoding_format: "float",
  });

  return resp.data.map((d) => d.embedding as number[]);
}

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".backups",
  ".ailss",
  "node_modules",
]);

function isDefaultIgnoredRelPath(relPath: string): boolean {
  const segments = relPath.split(path.posix.sep);
  for (const dir of segments.slice(0, -1)) {
    if (DEFAULT_IGNORE_DIRS.has(dir)) return true;
  }
  return false;
}

async function runIndexCommand(options: IndexCommandOptions): Promise<void> {
  const env = loadEnv();

  const vaultPath = options.vault ?? env.vaultPath;
  if (!vaultPath) {
    throw new Error("Vault path is missing. Set --vault or AILSS_VAULT_PATH.");
  }

  const embeddingModel = options.model ?? env.openaiEmbeddingModel;
  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Set it via .env or environment variables.");
  }

  const dbPath = options.db ?? (await resolveDefaultDbPath(vaultPath));
  const embeddingDim = embeddingDimForModel(embeddingModel);

  if (options.resetDb) {
    console.log(`[ailss-indexer] reset-db: deleting ${dbPath}`);
    await fs.rm(dbPath, { force: true });
    await fs.rm(`${dbPath}-wal`, { force: true });
    await fs.rm(`${dbPath}-shm`, { force: true });
  }

  const db = openAilssDb({ dbPath, embeddingModel, embeddingDim });
  const client = await createOpenAiClient(openaiApiKey);

  const requestedPaths = (options.paths ?? []).map((p) => p.trim()).filter(Boolean);
  const absPaths: string[] = [];
  let deletedFiles = 0;

  if (requestedPaths.length > 0) {
    const vaultRoot = path.resolve(vaultPath);
    const seenAbsPaths = new Set<string>();

    for (const inputPath of requestedPaths) {
      const candidateAbs = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(vaultPath, inputPath);

      if (!candidateAbs.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Refusing to index a path outside the vault: ${inputPath}`);
      }

      if (!candidateAbs.toLowerCase().endsWith(".md")) {
        continue;
      }

      const relPath = relPathFromAbs(vaultPath, candidateAbs);
      if (isDefaultIgnoredRelPath(relPath)) {
        continue;
      }

      try {
        await fs.stat(candidateAbs);
        if (seenAbsPaths.has(candidateAbs)) continue;
        seenAbsPaths.add(candidateAbs);
        absPaths.push(candidateAbs);
      } catch {
        deleteFileByPath(db, relPath);
        deletedFiles += 1;
      }
    }
  } else {
    absPaths.push(...(await listMarkdownFiles(vaultPath)));
  }

  const existingRelPaths =
    requestedPaths.length > 0
      ? null
      : new Set(absPaths.map((absPath) => relPathFromAbs(vaultPath, absPath)));

  console.log(`[ailss-indexer] vault=${vaultPath}`);
  console.log(`[ailss-indexer] db=${dbPath}`);
  console.log(`[ailss-indexer] files=${absPaths.length}`);

  let changedFiles = 0;
  let indexedChunks = 0;

  for (const absPath of absPaths) {
    const file = await statMarkdownFile(vaultPath, absPath);
    const prevSha = getFileSha256(db, file.relPath);

    const shaUnchanged = !!prevSha && prevSha === file.sha256;
    const isFullVaultRun = requestedPaths.length === 0;

    // Incremental runs (auto-index via --paths) skip unchanged files entirely.
    // Full vault runs refresh note metadata/typed-links for every file, but only recompute embeddings when the sha changes.
    if (shaUnchanged && !isFullVaultRun) continue;

    const needsEmbeddingUpdate = !shaUnchanged;
    if (needsEmbeddingUpdate) {
      changedFiles += 1;
      console.log(`\n[index] ${file.relPath}`);
    } else {
      console.log(`\n[meta] ${file.relPath}`);
    }

    const markdown = await readUtf8File(file.absPath);
    const parsed = parseMarkdownNote(markdown);
    const chunks = needsEmbeddingUpdate
      ? chunkMarkdownByHeadings(parsed.body, { maxChars: options.maxChars })
      : [];
    const noteMeta = normalizeAilssNoteMeta(parsed.frontmatter);
    const bodyLinks = extractWikilinkTypedLinksFromMarkdownBody(parsed.body);

    // Upsert file metadata
    upsertFile(db, {
      path: file.relPath,
      mtimeMs: file.mtimeMs,
      sizeBytes: file.size,
      sha256: file.sha256,
    });

    // Note metadata and typed links
    upsertNote(db, {
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
    replaceNoteTags(db, file.relPath, noteMeta.tags);
    replaceNoteKeywords(db, file.relPath, noteMeta.keywords);
    replaceTypedLinks(db, file.relPath, [...noteMeta.typedLinks, ...bodyLinks]);

    if (!needsEmbeddingUpdate) {
      continue;
    }

    // Delete and reinsert chunks for this file
    deleteChunksByPath(db, file.relPath);

    // Embedding batch calls
    const batchSize = Math.max(1, options.batchSize);
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const embeddings = await embedTexts(
        client,
        embeddingModel,
        batch.map((c) => c.content),
      );

      for (const [j, chunk] of batch.entries()) {
        const embedding = embeddings[j];
        if (!embedding) {
          throw new Error(
            `Embedding response returned too few embeddings. batchSize=${batch.length}, got=${embeddings.length}`,
          );
        }

        // Global chunk_id includes file path + ordinal to avoid collisions
        // - identical heading paths + identical content can occur within one note
        const chunkOrdinal = i + j;
        const chunkId = sha256Text(
          `${file.relPath}\n${chunkOrdinal}\n${JSON.stringify(chunk.headingPath)}\n${chunk.contentSha256}`,
        );

        insertChunkWithEmbedding(db, {
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

      process.stdout.write(
        `[chunks] ${Math.min(i + batch.length, chunks.length)}/${chunks.length}\r`,
      );
    }

    process.stdout.write("\n");
    console.log(`[done] chunks=${chunks.length}`);
  }

  if (existingRelPaths) {
    for (const indexedPath of listFilePaths(db)) {
      if (existingRelPaths.has(indexedPath)) continue;
      deleteFileByPath(db, indexedPath);
      deletedFiles += 1;
    }
  }

  console.log(
    `\n[summary] changedFiles=${changedFiles}, indexedChunks=${indexedChunks}, deletedFiles=${deletedFiles}`,
  );
}

const program = new Command();

program
  .name("ailss-indexer")
  .description("AILSS vault indexing CLI (embeddings + sqlite-vec)")
  .option("--vault <path>", "Absolute path to the Obsidian vault")
  .option("--db <path>", "DB file path (default: <vault>/.ailss/index.sqlite)")
  .option("--model <name>", "OpenAI embeddings model")
  .option("--paths <paths...>", "Only index these vault-relative markdown paths")
  .option("--reset-db", "Delete and recreate the DB before indexing")
  .option("--max-chars <n>", "Max chunk size (characters)", (v) => Number(v), 4000)
  .option("--batch-size <n>", "Embedding request batch size", (v) => Number(v), 32);

program.action(async (opts) => {
  const options: IndexCommandOptions = {
    vault: opts.vault,
    db: opts.db,
    model: opts.model,
    paths: opts.paths,
    resetDb: opts.resetDb,
    maxChars: opts.maxChars,
    batchSize: opts.batchSize,
  };

  try {
    await runIndexCommand(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ailss-indexer] error: ${message}`);
    process.exitCode = 1;
  }
});

await program.parseAsync(process.argv);
