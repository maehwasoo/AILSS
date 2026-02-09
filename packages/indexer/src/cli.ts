#!/usr/bin/env node
// AILSS indexer CLI
// - vault → chunking → embeddings → SQLite(vec) storage

import { Command } from "commander";
import OpenAI from "openai";

import {
  loadEnv,
  openAilssDb,
  resolveDefaultDbPath,
  resolveNeo4jSettings,
  syncSqliteGraphToNeo4j,
} from "@ailss/core";

import { promises as fs } from "node:fs";

import { indexVault } from "./indexVault.js";

type IndexCommandOptions = {
  vault?: string;
  db?: string;
  model?: string;
  paths?: string[];
  resetDb?: boolean;
  maxChars: number;
  batchSize: number;
};

function embeddingDimForModel(model: string): number {
  // OpenAI embeddings v3 default dimensions
  // - If the caller sets a custom `dimensions`, this may differ; for now we use model defaults
  if (model === "text-embedding-3-large") return 3072;
  return 1536;
}

async function createOpenAiClient(apiKey: string): Promise<OpenAI> {
  return new OpenAI({ apiKey });
}

async function syncNeo4jMirrorIfEnabled(
  db: ReturnType<typeof openAilssDb>,
  env: ReturnType<typeof loadEnv>,
): Promise<void> {
  const settings = resolveNeo4jSettings(env);
  if (!settings.enabled || !settings.syncOnIndex) return;

  if (!settings.config) {
    const message =
      settings.unavailableReason ??
      "Neo4j configuration is missing. Set AILSS_NEO4J_URI, AILSS_NEO4J_USERNAME, and AILSS_NEO4J_PASSWORD.";
    if (settings.strictMode) {
      throw new Error(`${message} Disable strict mode with AILSS_NEO4J_STRICT_MODE=0 if needed.`);
    }
    console.warn(`[ailss-indexer] neo4j sync skipped: ${message}`);
    return;
  }

  try {
    const summary = await syncSqliteGraphToNeo4j(db, settings.config);
    console.log(
      [
        "[ailss-indexer] neo4j sync complete",
        `sqlite.notes=${summary.sqliteCounts.notes}`,
        `sqlite.typed_links=${summary.sqliteCounts.typedLinks}`,
        `neo4j.notes=${summary.neo4jCounts.notes}`,
        `neo4j.typed_links=${summary.neo4jCounts.typedLinks}`,
        `neo4j.targets=${summary.neo4jCounts.targets}`,
        `consistent=${summary.consistent}`,
      ].join(" "),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (settings.strictMode) {
      throw new Error(`Neo4j sync failed in strict mode: ${message}`);
    }
    console.warn(`[ailss-indexer] neo4j sync skipped due to error: ${message}`);
  }
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

  await indexVault({
    db,
    dbPath,
    vaultPath,
    openai: client,
    embeddingModel,
    maxChars: options.maxChars,
    batchSize: options.batchSize,
    ...(options.paths ? { paths: options.paths } : {}),
    logger: { log: (line) => console.log(line), write: (text) => process.stdout.write(text) },
  });

  await syncNeo4jMirrorIfEnabled(db, env);
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
