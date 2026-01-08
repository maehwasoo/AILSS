// new_note tool
// - vault filesystem create (explicit apply)
// - full frontmatter template by default

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath, parseMarkdownNote } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import {
  buildAilssFrontmatter,
  defaultTagsForRelPath,
  renderMarkdownWithFrontmatter,
} from "../lib/ailssNoteTemplate.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";
import { resolveVaultPathSafely, writeVaultFileText } from "../lib/vaultFs.js";

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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

export function registerNewNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "new_note",
    {
      title: "New note",
      description:
        "Creates a new Markdown note in the vault. Prepends a full AILSS frontmatter template (or merges/normalizes an existing frontmatter block). Requires AILSS_VAULT_PATH. No write occurs unless apply=true.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown path to create (must end with ".md")'),
        title: z.string().min(1).optional().describe("Frontmatter title override (optional)"),
        text: z
          .string()
          .default("")
          .describe("Note markdown content (may include a frontmatter block)"),
        apply: z.boolean().default(false).describe("Apply file write; false = dry-run"),
        overwrite: z.boolean().default(false).describe("Allow overwriting an existing note"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true and the write succeeds, also reindex this path into the DB"),
        frontmatter: z.record(z.any()).optional().describe("Frontmatter overrides (optional)"),
      },
      outputSchema: z.object({
        path: z.string(),
        applied: z.boolean(),
        exists_before: z.boolean(),
        can_apply: z.boolean(),
        created: z.boolean(),
        overwritten: z.boolean(),
        sha256: z.string(),
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
        throw new Error("Cannot create files because AILSS_VAULT_PATH is not set.");
      }
      if (path.posix.extname(args.path).toLowerCase() !== ".md") {
        throw new Error(`Refusing to create non-markdown file: path="${args.path}".`);
      }
      if (isDefaultIgnoredVaultRelPath(args.path)) {
        throw new Error(`Refusing to create note in ignored folder: path="${args.path}".`);
      }

      const abs = resolveVaultPathSafely(vaultPath, args.path);
      const dir = path.dirname(abs);

      const parsed = parseMarkdownNote(args.text);
      const titleFromPath = path.posix.basename(args.path).replace(/\.md$/i, "");
      const resolvedTitle =
        args.title ??
        (typeof parsed.frontmatter.title === "string" && parsed.frontmatter.title.trim()
          ? parsed.frontmatter.title.trim()
          : titleFromPath);
      const frontmatter = buildAilssFrontmatter({
        title: resolvedTitle,
        tags: defaultTagsForRelPath(args.path),
        preserve: parsed.frontmatter,
        overrides: { ...(args.frontmatter ?? {}), title: resolvedTitle },
      });
      const markdown = renderMarkdownWithFrontmatter({ frontmatter, body: parsed.body });
      const sha256 = sha256HexUtf8(markdown);

      const run = async () => {
        const existsBefore = await fileExists(abs);
        const canApply = !existsBefore || Boolean(args.overwrite);

        if (args.apply && !canApply) {
          throw new Error(`Refusing to overwrite existing note: path="${args.path}".`);
        }

        if (!args.apply) {
          const payload = {
            path: args.path,
            applied: false,
            exists_before: existsBefore,
            can_apply: canApply,
            created: false,
            overwritten: false,
            sha256,
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

        await fs.mkdir(dir, { recursive: true });
        await writeVaultFileText({ vaultPath, vaultRelPath: args.path, text: markdown });

        let reindexed = false;
        let reindexSummary: {
          changed_files: number;
          indexed_chunks: number;
          deleted_files: number;
        } | null = null;
        let reindexError: string | null = null;

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

        const payload = {
          path: args.path,
          applied: true,
          exists_before: existsBefore,
          can_apply: canApply,
          created: !existsBefore,
          overwritten: existsBefore,
          sha256,
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
