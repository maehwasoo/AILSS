// canonicalize_typed_links tool
// - single-note frontmatter typed-link canonicalization

import { createHash } from "node:crypto";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath, parseMarkdownNote } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { splitFrontmatter } from "../lib/canonicalizeTypedLinks/frontmatterSplit.js";
import { planCanonicalizeTypedLinkEdits } from "../lib/canonicalizeTypedLinks/planEdits.js";
import { renderMarkdownWithFrontmatter } from "../lib/canonicalizeTypedLinks/yamlRender.js";
import { readVaultFileFullText, writeVaultFileText } from "../lib/vaultFs.js";
import { applyAndOptionalReindex, runWithOptionalWriteLock } from "../lib/writeToolExecution.js";

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function registerCanonicalizeTypedLinksTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "canonicalize_typed_links",
    {
      title: "Canonicalize typed links",
      description:
        "Canonicalizes frontmatter typed-link targets in a single note to deterministic vault-relative paths when resolution is unique. Dry-run by default.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown note path (e.g. "Projects/Plan.md")'),
        apply: z
          .boolean()
          .default(false)
          .describe("Apply file write; false = dry-run (preview only)"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true and content changed, also reindex this path into the DB"),
      },
      outputSchema: z.object({
        path: z.string(),
        applied: z.boolean(),
        changed: z.boolean(),
        before_sha256: z.string(),
        after_sha256: z.string(),
        edits: z.array(
          z.object({
            rel: z.string(),
            index: z.number().int().nonnegative(),
            before: z.string(),
            after: z.string(),
            target_before: z.string(),
            target_after: z.string(),
          }),
        ),
        unresolved: z.array(
          z.object({
            rel: z.string(),
            index: z.number().int().nonnegative(),
            before: z.string(),
            target: z.string(),
          }),
        ),
        ambiguous: z.array(
          z.object({
            rel: z.string(),
            index: z.number().int().nonnegative(),
            before: z.string(),
            target: z.string(),
            candidates: z.array(
              z.object({
                path: z.string(),
                title: z.string().nullable(),
                matched_by: z.union([z.literal("path"), z.literal("note_id"), z.literal("title")]),
              }),
            ),
          }),
        ),
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
        throw new Error("Cannot canonicalize typed links because AILSS_VAULT_PATH is not set.");
      }
      if (path.posix.extname(args.path).toLowerCase() !== ".md") {
        throw new Error(`Refusing to edit non-markdown file: path="${args.path}".`);
      }
      if (isDefaultIgnoredVaultRelPath(args.path)) {
        throw new Error(`Refusing to edit ignored path: path="${args.path}".`);
      }

      const run = async () => {
        const beforeText = await readVaultFileFullText({ vaultPath, vaultRelPath: args.path });
        const beforeSha256 = sha256HexUtf8(beforeText);
        const parsed = parseMarkdownNote(beforeText);
        const split = splitFrontmatter(beforeText);

        const frontmatter = (parsed.frontmatter ?? {}) as Record<string, unknown>;
        const { nextFrontmatter, edits, unresolved, ambiguous } = planCanonicalizeTypedLinkEdits({
          db: deps.db,
          frontmatter,
        });

        let afterText = beforeText;
        if (edits.length > 0 && split) {
          afterText = renderMarkdownWithFrontmatter(nextFrontmatter, split.body);
        }

        const afterSha256 = sha256HexUtf8(afterText);
        const changed = afterSha256 !== beforeSha256;

        const reindexState = await applyAndOptionalReindex({
          deps,
          apply: args.apply,
          changed,
          reindexAfterApply: args.reindex_after_apply,
          reindexPaths: [args.path],
          applyWrite: async () => {
            await writeVaultFileText({ vaultPath, vaultRelPath: args.path, text: afterText });
          },
        });

        const payload = {
          path: args.path,
          applied: reindexState.applied,
          changed,
          before_sha256: beforeSha256,
          after_sha256: afterSha256,
          edits,
          unresolved,
          ambiguous,
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
