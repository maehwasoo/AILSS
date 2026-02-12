// edit_note tool
// - vault filesystem write (explicit apply)
// - patch ops (line-based)

import { createHash } from "node:crypto";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { applyLinePatchOps, type LinePatchOp } from "../lib/textPatch.js";
import { readVaultFileFullText, writeVaultFileText } from "../lib/vaultFs.js";
import { applyAndOptionalReindex, runWithOptionalWriteLock } from "../lib/writeToolExecution.js";

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const linePatchOpSchema = z
  .object({
    op: z.enum(["insert_lines", "delete_lines", "replace_lines"]),
    at_line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "For insert_lines: 1-based line number to insert before (max = lineCount+1; use lineCount+1 to append)",
      ),
    from_line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("For delete/replace: 1-based start line"),
    to_line: z.number().int().min(1).optional().describe("For delete/replace: 1-based end line"),
    text: z.string().optional().describe("For insert/replace: text payload (may contain newlines)"),
  })
  .superRefine((op, ctx) => {
    if (op.op === "insert_lines") {
      if (typeof op.at_line !== "number") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["at_line"],
          message: 'insert_lines requires "at_line".',
        });
      }
      if (typeof op.text !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: 'insert_lines requires "text".',
        });
      }
      return;
    }

    if (typeof op.from_line !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from_line"],
        message: `${op.op} requires "from_line".`,
      });
    }
    if (typeof op.to_line !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_line"],
        message: `${op.op} requires "to_line".`,
      });
    }
    if (op.op === "replace_lines" && typeof op.text !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: 'replace_lines requires "text".',
      });
    }
  });

type LinePatchOpInput = z.infer<typeof linePatchOpSchema>;

function normalizeLinePatchOp(op: LinePatchOpInput): LinePatchOp {
  switch (op.op) {
    case "insert_lines":
      return { op: "insert_lines", at_line: op.at_line!, text: op.text! };
    case "delete_lines":
      return { op: "delete_lines", from_line: op.from_line!, to_line: op.to_line! };
    case "replace_lines":
      return {
        op: "replace_lines",
        from_line: op.from_line!,
        to_line: op.to_line!,
        text: op.text!,
      };
  }
}

export function registerEditNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "edit_note",
    {
      title: "Edit note",
      description:
        "Edits an existing vault Markdown note by applying line-based patch ops (insert/delete/replace). Requires AILSS_VAULT_PATH. No write occurs unless apply=true (line numbers are 1-based; append via insert_lines at lineCount+1).",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown note path to edit (e.g. "Projects/Plan.md")'),
        expected_sha256: z
          .string()
          .regex(/^[0-9a-fA-F]{64}$/)
          .optional()
          .describe("Optional concurrency guard; rejects if the current file sha256 differs"),
        apply: z
          .boolean()
          .default(false)
          .describe("Apply file write; false = dry-run (preview only)"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true and content changed, also reindex this path into the DB"),
        ops: z
          .array(linePatchOpSchema)
          .min(1)
          .describe(
            [
              "Patch ops applied in order (use apply=false for a dry-run).",
              "Each op is an object with op ∈ {insert_lines, delete_lines, replace_lines}.",
              "insert_lines requires: at_line, text.",
              "delete_lines requires: from_line, to_line.",
              "replace_lines requires: from_line, to_line, text.",
            ].join(" "),
          ),
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

        const normalizedOps = args.ops.map(normalizeLinePatchOp);
        const { text: afterText } = applyLinePatchOps(beforeText, normalizedOps);
        const afterSha256 = sha256HexUtf8(afterText);
        const changed = afterSha256 !== beforeSha256;

        const reindexState = await applyAndOptionalReindex({
          deps,
          apply: args.apply,
          changed,
          reindexAfterApply: args.reindex_after_apply,
          reindexPaths: [args.path],
          applyWrite: async () => {
            await writeVaultFileText({
              vaultPath,
              vaultRelPath: args.path,
              text: afterText,
            });
          },
        });

        const payload = {
          path: args.path,
          applied: reindexState.applied,
          changed,
          before_sha256: beforeSha256,
          after_sha256: afterSha256,
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
