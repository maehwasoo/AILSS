import { promises as fs } from "node:fs";
import path from "node:path";

import { deleteFileByPath } from "../../../db/db.js";
import { isDefaultIgnoredVaultRelPath, listMarkdownFiles } from "../../../vault/filesystem.js";

import type { IndexVaultOptions, ResolvedIndexTargets } from "../types.js";

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

export async function resolveIndexTargetsStage(
  options: IndexVaultOptions,
): Promise<ResolvedIndexTargets> {
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
