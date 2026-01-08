// edit_note tool
// - vault filesystem write (explicit apply)
// - patch ops (line-based)

import { createHash } from "node:crypto";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";
import { applyLinePatchOps } from "../lib/textPatch.js";
import { readVaultFileFullText, writeVaultFileText } from "../lib/vaultFs.js";

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function registerEditNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "edit_note",
    {
      title: "Edit note",
      description:
        "Edits an existing vault Markdown note by applying line-based patch ops. Requires AILSS_VAULT_PATH. Writes only when apply=true.",
      inputSchema: {
        path: z.string().min(1).describe('Vault-relative note path (e.g. "Projects/Plan.md")'),
        expected_sha256: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .optional()
          .describe("Optimistic concurrency guard; rejects if the current file sha256 differs"),
        apply: z.boolean().default(false).describe("Apply file write; false = dry-run"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true and content changed, also reindex this path into the DB"),
        ops: z
          .array(
            z.union([
              z.object({
                op: z.literal("insert_lines"),
                at_line: z
                  .number()
                  .int()
                  .min(1)
                  .describe("1-based line number to insert before (max = lineCount+1)"),
                text: z.string().describe("Text to insert (may contain newlines)"),
              }),
              z.object({
                op: z.literal("delete_lines"),
                from_line: z.number().int().min(1).describe("1-based start line (inclusive)"),
                to_line: z.number().int().min(1).describe("1-based end line (inclusive)"),
              }),
              z.object({
                op: z.literal("replace_lines"),
                from_line: z.number().int().min(1).describe("1-based start line (inclusive)"),
                to_line: z.number().int().min(1).describe("1-based end line (inclusive)"),
                text: z.string().describe("Replacement text (may contain newlines)"),
              }),
            ]),
          )
          .min(1)
          .describe("Patch ops applied in order"),
      },
      outputSchema: z.object({
        path: z.string(),
        applied: z.boolean(),
        changed: z.boolean(),
        before_sha256: z.string(),
        after_sha256: z.string(),
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
        throw new Error("Cannot edit files because AILSS_VAULT_PATH is not set.");
      }
      if (path.posix.extname(args.path).toLowerCase() !== ".md") {
        throw new Error(`Refusing to edit non-markdown file: path="${args.path}".`);
      }

      const run = async () => {
        const beforeText = await readVaultFileFullText({
          vaultPath,
          vaultRelPath: args.path,
        });
        const beforeSha256 = sha256HexUtf8(beforeText);

        if (args.expected_sha256 && args.expected_sha256 !== beforeSha256) {
          throw new Error(
            [
              "Edit rejected due to sha256 mismatch.",
              `path="${args.path}"`,
              `expected_sha256="${args.expected_sha256}"`,
              `actual_sha256="${beforeSha256}"`,
            ].join(" "),
          );
        }

        const { text: afterText } = applyLinePatchOps(beforeText, args.ops);
        const afterSha256 = sha256HexUtf8(afterText);
        const changed = afterSha256 !== beforeSha256;

        let reindexed = false;
        let reindexSummary: {
          changed_files: number;
          indexed_chunks: number;
          deleted_files: number;
        } | null = null;
        let reindexError: string | null = null;

        if (args.apply && changed) {
          await writeVaultFileText({
            vaultPath,
            vaultRelPath: args.path,
            text: afterText,
          });

          if (args.reindex_after_apply) {
            try {
              const summary = await reindexVaultPaths(deps, [args.path]);
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
        }

        const payload = {
          path: args.path,
          applied: Boolean(args.apply && changed),
          changed,
          before_sha256: beforeSha256,
          after_sha256: afterSha256,
          needs_reindex: Boolean(args.apply && changed && !reindexed),
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
