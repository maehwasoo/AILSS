// Vault 파일 시스템(file system) 접근 유틸
// - indexer에서 마크다운 목록 스캔, 파일 읽기에 사용

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type VaultMarkdownFile = {
  absPath: string;
  relPath: string;
  mtimeMs: number;
  size: number;
  sha256: string;
};

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".backups",
  ".ailss",
  "node_modules",
]);

export async function listMarkdownFiles(vaultPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDirAbsPath: string) {
    const entries = await fs.readdir(currentDirAbsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
        await walk(path.join(currentDirAbsPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".md")) continue;

      results.push(path.join(currentDirAbsPath, entry.name));
    }
  }

  await walk(vaultPath);
  results.sort();
  return results;
}

export async function statMarkdownFile(
  vaultPath: string,
  absPath: string,
): Promise<VaultMarkdownFile> {
  const stat = await fs.stat(absPath);
  const relPath = path.relative(vaultPath, absPath);
  const contents = await fs.readFile(absPath);
  const sha256 = createHash("sha256").update(contents).digest("hex");

  return {
    absPath,
    relPath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256,
  };
}

export async function readUtf8File(absPath: string): Promise<string> {
  return await fs.readFile(absPath, "utf8");
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
