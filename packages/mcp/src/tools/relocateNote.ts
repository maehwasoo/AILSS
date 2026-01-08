// relocate_note tool
// - move/rename a note within the vault (explicit apply)

import { promises as fs } from "node:fs";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";
import { resolveVaultPathSafely } from "../lib/vaultFs.js";

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath);
    return true;
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function renameOrCopy(fromAbs: string, toAbs: string): Promise<void> {
  try {
    await fs.rename(fromAbs, toAbs);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "EXDEV") throw error;
    await fs.copyFile(fromAbs, toAbs);
    await fs.unlink(fromAbs);
  }
}

export function registerRelocateNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "relocate_note",
    {
      title: "Relocate note",
      description:
        "Moves/renames a vault Markdown note. Requires AILSS_VAULT_PATH. Writes only when apply=true.",
      inputSchema: {
        from_path: z
          .string()
          .min(1)
          .describe('Source vault-relative Markdown path (e.g. "Projects/Old.md")'),
        to_path: z
          .string()
          .min(1)
          .describe('Destination vault-relative Markdown path (e.g. "Projects/New.md")'),
        apply: z.boolean().default(false).describe("Apply file move; false = dry-run"),
        overwrite: z
          .boolean()
          .default(false)
          .describe("Allow overwriting destination if it exists"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true, also reindex (delete old path + index new path)"),
      },
      outputSchema: z.object({
        from_path: z.string(),
        to_path: z.string(),
        applied: z.boolean(),
        overwritten: z.boolean(),
        needs_reindex: z.boolean(),
        reindexed: z.boolean(),
        reindex_summary: z
          .object({
            changed_files: z.number().int().nonnegative(),
            indexed_chunks: z.number().int().nonnegative(),
            deleted_files: z.number().int().nonnegative(),
          })
          .nullable(),
        reindex_error: z.string().nullable(),
      }),
    },
    async (args) => {
      const vaultPath = deps.vaultPath;
      if (!vaultPath) {
        throw new Error("Cannot relocate notes because AILSS_VAULT_PATH is not set.");
      }

      if (path.posix.extname(args.from_path).toLowerCase() !== ".md") {
        throw new Error(`Refusing to relocate non-markdown file: from_path="${args.from_path}".`);
      }
      if (path.posix.extname(args.to_path).toLowerCase() !== ".md") {
        throw new Error(`Refusing to relocate non-markdown file: to_path="${args.to_path}".`);
      }

      if (isDefaultIgnoredVaultRelPath(args.from_path)) {
        throw new Error(`Refusing to relocate ignored path: from_path="${args.from_path}".`);
      }
      if (isDefaultIgnoredVaultRelPath(args.to_path)) {
        throw new Error(`Refusing to relocate into ignored path: to_path="${args.to_path}".`);
      }

      const fromAbs = resolveVaultPathSafely(vaultPath, args.from_path);
      const toAbs = resolveVaultPathSafely(vaultPath, args.to_path);
      const toDir = path.dirname(toAbs);

      const run = async () => {
        if (!(await fileExists(fromAbs))) {
          throw new Error(`Source note not found: from_path="${args.from_path}".`);
        }

        const destExists = await fileExists(toAbs);
        const overwritten = Boolean(destExists && args.overwrite);

        if (destExists && !args.overwrite) {
          throw new Error(`Destination already exists: to_path="${args.to_path}".`);
        }

        if (!args.apply) {
          const payload = {
            from_path: args.from_path,
            to_path: args.to_path,
            applied: false,
            overwritten: false,
            needs_reindex: false,
            reindexed: false,
            reindex_summary: null,
            reindex_error: null,
          };
          return {
            structuredContent: payload,
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          };
        }

        await fs.mkdir(toDir, { recursive: true });
        if (destExists && args.overwrite) {
          await fs.unlink(toAbs);
        }

        await renameOrCopy(fromAbs, toAbs);

        let reindexed = false;
        let reindexSummary: {
          changed_files: number;
          indexed_chunks: number;
          deleted_files: number;
        } | null = null;
        let reindexError: string | null = null;

        if (args.reindex_after_apply) {
          try {
            const summary = await reindexVaultPaths(deps, [args.from_path, args.to_path]);
            reindexed = true;
            reindexSummary = {
              changed_files: summary.changedFiles,
              indexed_chunks: summary.indexedChunks,
              deleted_files: summary.deletedFiles,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reindexError = message;
          }
        }

        const payload = {
          from_path: args.from_path,
          to_path: args.to_path,
          applied: true,
          overwritten,
          needs_reindex: Boolean(!reindexed),
          reindexed,
          reindex_summary: reindexSummary,
          reindex_error: reindexError,
        };

        return {
          structuredContent: payload,
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      };

      if (args.apply) {
        return await (deps.writeLock ? deps.writeLock.runExclusive(run) : run());
      }
      return await run();
    },
  );
}
