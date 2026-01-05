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
