// capture_note tool
// - create a new note with full AILSS frontmatter (explicit apply)
// - default folder: 100. Inbox

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import {
  buildAilssFrontmatter,
  defaultTagsForRelPath,
  nowIsoSeconds,
  renderMarkdownWithFrontmatter,
} from "../lib/ailssNoteTemplate.js";
import { resolveVaultPathSafely, writeVaultFileText } from "../lib/vaultFs.js";
import { applyAndOptionalReindex, runWithOptionalWriteLock } from "../lib/writeToolExecution.js";

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeFileStemFromTitle(title: string): string {
  const trimmed = title.trim();
  // Remove path separators and control chars; keep it readable.
  const noSeparators = trimmed.replace(/[\\/]+/g, "-");
  const collapsed = noSeparators.replace(/\s+/g, " ").trim();
  const shortened = collapsed.length > 120 ? collapsed.slice(0, 120).trim() : collapsed;
  return shortened || "Untitled";
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

async function findAvailablePath(options: {
  vaultPath: string;
  folder: string;
  stem: string;
}): Promise<string> {
  const folder = options.folder.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
  const baseStem = options.stem;

  const tryRel = (suffix: string) =>
    folder ? path.posix.join(folder, `${baseStem}${suffix}.md`) : `${baseStem}${suffix}.md`;

  const first = tryRel("");
  if (!isDefaultIgnoredVaultRelPath(first)) {
    const firstAbs = resolveVaultPathSafely(options.vaultPath, first);
    if (!(await fileExists(firstAbs))) return first;
  }

  for (let i = 2; i <= 50; i += 1) {
    const rel = tryRel(` (${i})`);
    if (isDefaultIgnoredVaultRelPath(rel)) continue;
    const abs = resolveVaultPathSafely(options.vaultPath, rel);
    if (!(await fileExists(abs))) return rel;
  }

  // Last resort: timestamp-based.
  const now = nowIsoSeconds();
  const fallback = tryRel(`-${now.replace(/[-:T]/g, "").slice(0, 14)}`);
  if (isDefaultIgnoredVaultRelPath(fallback)) {
    throw new Error(`Refusing to create note in ignored folder: path="${fallback}"`);
  }
  return fallback;
}

export function registerCaptureNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "capture_note",
    {
      title: "Capture note",
      description: [
        'Creates a new note in the vault (default folder: "100. Inbox") with full AILSS frontmatter.',
        "Requires AILSS_VAULT_PATH.",
        "Safety: prefer apply=false (dry-run) first; only write when apply=true after confirmation.",
        "Tip: avoid overriding identity fields like id/created unless explicitly requested.",
      ].join(" "),
      inputSchema: {
        title: z.string().min(1).describe("Note title"),
        body: z.string().default("").describe("Note body (markdown)."),
        folder: z
          .string()
          .default("100. Inbox")
          .describe('Vault-relative folder to create into (default: "100. Inbox")'),
        apply: z.boolean().default(false).describe("Apply file write; false = dry-run"),
        reindex_after_apply: z
          .boolean()
          .default(true)
          .describe("If apply=true, also reindex the created path into the DB"),
        frontmatter: z.record(z.any()).optional().describe("Frontmatter overrides (optional)"),
      },
      outputSchema: z.object({
        path: z.string(),
        applied: z.boolean(),
        note_id: z.string(),
        created: z.string(),
        title: z.string(),
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
        throw new Error("Cannot capture notes because AILSS_VAULT_PATH is not set.");
      }

      const folder = args.folder.trim();
      const stem = sanitizeFileStemFromTitle(args.title);
      const relPath = await findAvailablePath({ vaultPath, folder, stem });

      if (isDefaultIgnoredVaultRelPath(relPath)) {
        throw new Error(`Refusing to create note in ignored folder: path="${relPath}"`);
      }

      const now = nowIsoSeconds();
      const frontmatter = buildAilssFrontmatter({
        title: args.title.trim(),
        now,
        tags: defaultTagsForRelPath(relPath),
        ...(args.frontmatter ? { overrides: args.frontmatter } : {}),
      });
      const markdown = renderMarkdownWithFrontmatter({ frontmatter, body: args.body });
      const sha256 = sha256HexUtf8(markdown);

      const run = async () => {
        const reindexState = await applyAndOptionalReindex({
          deps,
          apply: args.apply,
          changed: true,
          reindexAfterApply: args.reindex_after_apply,
          reindexPaths: [relPath],
          applyWrite: async () => {
            const abs = resolveVaultPathSafely(vaultPath, relPath);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await writeVaultFileText({ vaultPath, vaultRelPath: relPath, text: markdown });
          },
        });

        const payload = {
          path: relPath,
          applied: reindexState.applied,
          note_id: String(frontmatter.id ?? ""),
          created: String(frontmatter.created ?? ""),
          title: String(frontmatter.title ?? ""),
          sha256,
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
