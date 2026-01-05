#!/usr/bin/env node
// AILSS indexer CLI
// - vault → chunking → embeddings → SQLite(vec) storage

import { Command } from "commander";
import OpenAI from "openai";

import {
  chunkMarkdownByHeadings,
  getFileSha256,
  normalizeAilssNoteMeta,
  insertChunkWithEmbedding,
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

type IndexCommandOptions = {
  vault?: string;
  db?: string;
  model?: string;
  maxChars: number;
  batchSize: number;
};

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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
  const db = openAilssDb({ dbPath, embeddingDim });
  const client = await createOpenAiClient(openaiApiKey);

  const absPaths = await listMarkdownFiles(vaultPath);
  console.log(`[ailss-indexer] vault=${vaultPath}`);
  console.log(`[ailss-indexer] db=${dbPath}`);
  console.log(`[ailss-indexer] files=${absPaths.length}`);

  let changedFiles = 0;
  let indexedChunks = 0;

  for (const absPath of absPaths) {
    const file = await statMarkdownFile(vaultPath, absPath);
    const prevSha = getFileSha256(db, file.relPath);

    if (prevSha && prevSha === file.sha256) {
      continue;
    }

    changedFiles += 1;
    console.log(`\n[index] ${file.relPath}`);

    const markdown = await readUtf8File(file.absPath);
    const parsed = parseMarkdownNote(markdown);
    const chunks = chunkMarkdownByHeadings(parsed.body, { maxChars: options.maxChars });
    const noteMeta = normalizeAilssNoteMeta(parsed.frontmatter);

    // Upsert file metadata
    upsertFile(db, {
      path: file.relPath,
      mtimeMs: file.mtimeMs,
      sizeBytes: file.size,
      sha256: file.sha256,
    });

    // Delete and reinsert chunks for this file
    deleteChunksByPath(db, file.relPath);

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
    replaceTypedLinks(db, file.relPath, noteMeta.typedLinks);

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

        // Global chunk_id includes file path to avoid collisions
        const chunkId = sha256Text(
          `${file.relPath}\n${JSON.stringify(chunk.headingPath)}\n${chunk.contentSha256}`,
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

  console.log(`\n[summary] changedFiles=${changedFiles}, indexedChunks=${indexedChunks}`);
}

const program = new Command();

program
  .name("ailss-indexer")
  .description("AILSS vault indexing CLI (embeddings + sqlite-vec)")
  .option("--vault <path>", "Absolute path to the Obsidian vault")
  .option("--db <path>", "DB file path (default: <vault>/.ailss/index.sqlite)")
  .option("--model <name>", "OpenAI embeddings model")
  .option("--max-chars <n>", "Max chunk size (characters)", (v) => Number(v), 4000)
  .option("--batch-size <n>", "Embedding request batch size", (v) => Number(v), 32);

program.action(async (opts) => {
  const options: IndexCommandOptions = {
    vault: opts.vault,
    db: opts.db,
    model: opts.model,
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
