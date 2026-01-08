// frontmatter_validate tool
// - filesystem scan + YAML frontmatter presence checks

import { listMarkdownFiles, parseMarkdownNote } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { promises as fs } from "node:fs";
import path from "node:path";

import type { McpToolDeps } from "../mcpDeps.js";

const REQUIRED_KEYS = [
  "id",
  "created",
  "title",
  "summary",
  "aliases",
  "entity",
  "layer",
  "tags",
  "keywords",
  "status",
  "updated",
] as const;

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function hasFrontmatterBlock(markdown: string): boolean {
  const normalized = (markdown ?? "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return false;
  const endIdx = normalized.indexOf("\n---\n", 4);
  const endDotsIdx = normalized.indexOf("\n...\n", 4);
  return endIdx >= 0 || endDotsIdx >= 0;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function idFromCreated(created: string): string | null {
  const trimmed = created.trim();
  if (!trimmed) return null;

  // Accept ISO with optional ms/timezone; use the first 19 chars if available.
  // - 2026-01-08T12:34:56(.123Z)
  const iso = trimmed.length >= 19 ? trimmed.slice(0, 19) : trimmed;
  const normalized = iso.replace(/ /g, "T");
  const digits = normalized.replace(/[-:T]/g, "");
  if (digits.length < 14) return null;
  return digits.slice(0, 14);
}

export function registerFrontmatterValidateTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "frontmatter_validate",
    {
      title: "Frontmatter validate",
      description:
        "Scans vault markdown notes and validates YAML frontmatter presence + required key presence. Also checks that `id` matches the first 14 digits of `created` (YYYYMMDDHHmmss).",
      inputSchema: {
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only validate notes under this vault-relative path prefix"),
        max_files: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .default(20_000)
          .describe("Hard limit on files scanned (safety bound)"),
      },
      outputSchema: z.object({
        path_prefix: z.string().nullable(),
        files_scanned: z.number().int().nonnegative(),
        ok_count: z.number().int().nonnegative(),
        issue_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        required_keys: z.array(z.string()),
        issues: z.array(
          z.object({
            path: z.string(),
            has_frontmatter: z.boolean(),
            parsed_frontmatter: z.boolean(),
            missing_keys: z.array(z.string()),
            id_value: z.string().nullable(),
            created_value: z.string().nullable(),
            id_format_ok: z.boolean(),
            created_format_ok: z.boolean(),
            id_matches_created: z.boolean(),
          }),
        ),
      }),
    },
    async (args) => {
      const vaultPath = deps.vaultPath;
      if (!vaultPath) {
        throw new Error("Cannot validate frontmatter because AILSS_VAULT_PATH is not set.");
      }

      const prefix = args.path_prefix ? args.path_prefix.trim() : null;
      const absFiles = await listMarkdownFiles(vaultPath);
      const relFiles = absFiles.map((abs) => relPathFromAbs(vaultPath, abs));
      const filtered = prefix ? relFiles.filter((p) => p.startsWith(prefix)) : relFiles;

      const issues: Array<{
        path: string;
        has_frontmatter: boolean;
        parsed_frontmatter: boolean;
        missing_keys: string[];
        id_value: string | null;
        created_value: string | null;
        id_format_ok: boolean;
        created_format_ok: boolean;
        id_matches_created: boolean;
      }> = [];

      let filesScanned = 0;
      let okCount = 0;
      let truncated = false;

      for (const relPath of filtered) {
        if (filesScanned >= args.max_files) {
          truncated = true;
          break;
        }

        const absPath = path.join(vaultPath, relPath);
        filesScanned += 1;

        const markdown = await fs.readFile(absPath, "utf8");
        const hasFm = hasFrontmatterBlock(markdown);
        const parsed = parseMarkdownNote(markdown);
        const fm = parsed.frontmatter ?? {};

        const missing: string[] = [];
        for (const key of REQUIRED_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(fm, key)) missing.push(key);
        }

        const idRaw = coerceString((fm as Record<string, unknown>).id);
        const createdRaw = coerceString((fm as Record<string, unknown>).created);
        const createdId = createdRaw ? idFromCreated(createdRaw) : null;

        const idValue = idRaw;
        const createdValue = createdRaw;

        const idFormatOk = typeof idValue === "string" && /^\d{14}$/.test(idValue);
        const createdFormatOk = typeof createdId === "string" && /^\d{14}$/.test(createdId);
        const idMatchesCreated = Boolean(idFormatOk && createdFormatOk && idValue === createdId);

        // We only count "ok" when the frontmatter exists and has all keys + consistent id/created.
        const parsedFrontmatter = hasFm && Object.keys(fm).length > 0;
        const isOk =
          hasFm &&
          parsedFrontmatter &&
          missing.length === 0 &&
          idFormatOk &&
          createdFormatOk &&
          idMatchesCreated;

        if (isOk) {
          okCount += 1;
          continue;
        }

        issues.push({
          path: relPath,
          has_frontmatter: hasFm,
          parsed_frontmatter: parsedFrontmatter,
          missing_keys: missing,
          id_value: idValue,
          created_value: createdValue,
          id_format_ok: idFormatOk,
          created_format_ok: createdFormatOk,
          id_matches_created: idMatchesCreated,
        });
      }

      const payload = {
        path_prefix: prefix,
        files_scanned: filesScanned,
        ok_count: okCount,
        issue_count: issues.length,
        truncated,
        required_keys: REQUIRED_KEYS.slice(),
        issues,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
