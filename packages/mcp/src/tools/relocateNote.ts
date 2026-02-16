// relocate_note tool
// - move/rename a note within the vault (explicit apply)

import { promises as fs } from "node:fs";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { nowIsoSeconds } from "../lib/ailssNoteTemplate.js";
import { resolveVaultPathSafely, writeVaultFileText } from "../lib/vaultFs.js";
import { applyAndOptionalReindex, runWithOptionalWriteLock } from "../lib/writeToolExecution.js";

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

function updateUpdatedInFrontmatterBlock(
  markdown: string,
  updatedIsoSeconds: string,
): {
  updated: boolean;
  nextMarkdown: string;
} {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return { updated: false, nextMarkdown: markdown };

  const endIndex = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (endIndex < 0) return { updated: false, nextMarkdown: markdown };

  const frontmatterStart = 1;
  const frontmatterEnd = 1 + endIndex;
  const frontmatterLines = lines.slice(frontmatterStart, frontmatterEnd);

  const updatedLine = `updated: ${JSON.stringify(updatedIsoSeconds)}`;
  const updatedKeyRegex = /^\s*updated\s*:/;

  const existingIndex = frontmatterLines.findIndex((l) => updatedKeyRegex.test(l));
  if (existingIndex >= 0) {
    frontmatterLines[existingIndex] = updatedLine;
  } else {
    const afterKeyRegex = /^\s*status\s*:/;
    const statusIndex = frontmatterLines.findIndex((l) => afterKeyRegex.test(l));
    if (statusIndex >= 0) {
      frontmatterLines.splice(statusIndex + 1, 0, updatedLine);
    } else {
      frontmatterLines.push(updatedLine);
    }
  }

  const rebuilt = ["---", ...frontmatterLines, "---", ...lines.slice(frontmatterEnd + 1)].join(
    "\n",
  );
  return { updated: true, nextMarkdown: rebuilt };
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
        updated_applied: z.boolean(),
        updated_value: z.string().nullable(),
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
        const now = nowIsoSeconds();
        if (!(await fileExists(fromAbs))) {
          throw new Error(`Source note not found: from_path="${args.from_path}".`);
        }

        const destExists = await fileExists(toAbs);
        const overwritten = Boolean(destExists && args.overwrite);

        if (destExists && !args.overwrite) {
          throw new Error(`Destination already exists: to_path="${args.to_path}".`);
        }

        let updatedApplied = false;
        const reindexState = await applyAndOptionalReindex({
          deps,
          apply: args.apply,
          changed: true,
          reindexAfterApply: args.reindex_after_apply,
          reindexPaths: [args.from_path, args.to_path],
          applyWrite: async () => {
            await fs.mkdir(toDir, { recursive: true });
            if (destExists && args.overwrite) {
              await fs.unlink(toAbs);
            }

            await renameOrCopy(fromAbs, toAbs);

            try {
              const movedText = await fs.readFile(toAbs, "utf8");
              const updated = updateUpdatedInFrontmatterBlock(movedText, now);
              if (updated.updated) {
                await writeVaultFileText({
                  vaultPath,
                  vaultRelPath: args.to_path,
                  text: updated.nextMarkdown,
                });
                updatedApplied = true;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              try {
                if (!(await fileExists(fromAbs))) {
                  await renameOrCopy(toAbs, fromAbs);
                }
              } catch {
                // rollback best-effort
              }
              throw new Error(
                `Failed to update frontmatter.updated for "${args.to_path}": ${message}`,
              );
            }
          },
        });

        const payload = {
          from_path: args.from_path,
          to_path: args.to_path,
          applied: reindexState.applied,
          overwritten: reindexState.applied ? overwritten : false,
          updated_applied: updatedApplied,
          updated_value: updatedApplied ? now : null,
          needs_reindex: reindexState.needs_reindex,
          reindexed: reindexState.reindexed,
          reindex_summary: reindexState.reindex_summary,
          reindex_error: reindexState.reindex_error,
        };

        return {
          structuredContent: payload,
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      };

      return await runWithOptionalWriteLock({ apply: args.apply, writeLock: deps.writeLock, run });
    },
  );
}
