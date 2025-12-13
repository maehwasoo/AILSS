#!/usr/bin/env node
// AILSS 인덱서(indexer) CLI
// - vault → 청킹(chunking) → 임베딩(embedding) → SQLite(vec) 저장

import { Command } from "commander";
import OpenAI from "openai";

import {
  chunkMarkdownByHeadings,
  getFileSha256,
  insertChunkWithEmbedding,
  listMarkdownFiles,
  loadEnv,
  openAilssDb,
  parseMarkdownNote,
  resolveDefaultDbPath,
  statMarkdownFile,
  upsertFile,
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
  // OpenAI embeddings v3 기본 차원(dimension)
  // - 사용자가 dimensions 옵션을 주면 바뀔 수 있으니, 현재는 model별 기본값 사용
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
    throw new Error("vault 경로가 없어요. --vault 또는 AILSS_VAULT_PATH를 설정해요.");
  }

  const embeddingModel = options.model ?? env.openaiEmbeddingModel;
  const openaiApiKey = env.openaiApiKey;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY가 없어요. .env 또는 환경변수로 설정해요.");
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

    // 파일 메타데이터 업서트(upsert)
    upsertFile(db, {
      path: file.relPath,
      mtimeMs: file.mtimeMs,
      sizeBytes: file.size,
      sha256: file.sha256,
    });

    // 기존 청크 삭제 후 재삽입
    deleteChunksByPath(db, file.relPath);

    // 임베딩 배치 호출
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
            `임베딩 결과 수가 부족해요. batchSize=${batch.length}, got=${embeddings.length}`,
          );
        }

        // 전역 chunk_id는 파일 경로를 포함해 충돌 방지
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
  .description("AILSS vault 인덱싱 CLI (embeddings + sqlite-vec)")
  .option("--vault <path>", "Obsidian vault 절대 경로")
  .option("--db <path>", "DB 파일 경로(기본: <vault>/.ailss/index.sqlite)")
  .option("--model <name>", "OpenAI embeddings model")
  .option("--max-chars <n>", "청크 최대 길이(문자 수)", (v) => Number(v), 4000)
  .option("--batch-size <n>", "임베딩 요청 배치 크기", (v) => Number(v), 32);

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
