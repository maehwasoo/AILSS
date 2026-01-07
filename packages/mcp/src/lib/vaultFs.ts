// Vault filesystem helpers
// - path traversal prevention
// - bounded reads

import { promises as fs } from "node:fs";
import path from "node:path";

export function resolveVaultPathSafely(vaultPath: string, vaultRelPath: string): string {
  const abs = path.resolve(vaultPath, vaultRelPath);
  if (!abs.startsWith(path.resolve(vaultPath) + path.sep)) {
    throw new Error("Refusing to access a path outside the vault.");
  }
  return abs;
}

export async function readVaultFileText(options: {
  vaultPath: string;
  vaultRelPath: string;
  maxChars: number;
}): Promise<{ text: string; truncated: boolean }> {
  const abs = resolveVaultPathSafely(options.vaultPath, options.vaultRelPath);
  const content = await fs.readFile(abs, "utf8");
  const truncated = content.length > options.maxChars;
  return { text: truncated ? content.slice(0, options.maxChars) : content, truncated };
}

export async function readVaultFileFullText(options: {
  vaultPath: string;
  vaultRelPath: string;
}): Promise<string> {
  const abs = resolveVaultPathSafely(options.vaultPath, options.vaultRelPath);
  return await fs.readFile(abs, "utf8");
}

async function atomicWriteUtf8File(absPath: string, text: string): Promise<void> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  const tmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`);

  await fs.writeFile(tmpPath, text, "utf8");

  try {
    await fs.rename(tmpPath, absPath);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES") {
      await fs.unlink(absPath).catch(() => undefined);
      await fs.rename(tmpPath, absPath);
      return;
    }

    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export async function writeVaultFileText(options: {
  vaultPath: string;
  vaultRelPath: string;
  text: string;
}): Promise<void> {
  const abs = resolveVaultPathSafely(options.vaultPath, options.vaultRelPath);
  await atomicWriteUtf8File(abs, options.text);
}
