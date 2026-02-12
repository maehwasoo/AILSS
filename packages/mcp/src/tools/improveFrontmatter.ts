// improve_frontmatter tool
// - normalize/add required AILSS frontmatter keys (explicit apply)

import { createHash } from "node:crypto";
import path from "node:path";

import {
  AILSS_TYPED_LINK_KEYS,
  isDefaultIgnoredVaultRelPath,
  parseMarkdownNote,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import {
  buildAilssFrontmatter,
  nowIsoSeconds,
  renderMarkdownWithFrontmatter,
} from "../lib/ailssNoteTemplate.js";
import {
  coerceNonEmptyString,
  hasFrontmatterBlock,
  idFromCreated,
} from "../lib/frontmatterIdentity.js";
import { readVaultFileFullText, writeVaultFileText } from "../lib/vaultFs.js";
import { applyAndOptionalReindex, runWithOptionalWriteLock } from "../lib/writeToolExecution.js";

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
  "source",
] as const;

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function titleFromPath(vaultRelPath: string): string {
  const base = path.posix.basename(vaultRelPath);
  const stem = base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
  return stem.trim() || "Untitled";
}

function normalizeStringList(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (v: unknown): void => {
    if (typeof v !== "string") return;
    const trimmed = v.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  if (typeof value === "string") push(value);
  else if (Array.isArray(value)) {
    for (const item of value) push(item);
  }

  return out;
}

function toWikilink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "[[]]";
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return trimmed;
  return `[[${trimmed}]]`;
}

function isoSecondsFromId(id: string): string | null {
  const trimmed = id.trim();
  if (!/^\d{14}$/.test(trimmed)) return null;
  const y = trimmed.slice(0, 4);
  const mo = trimmed.slice(4, 6);
  const d = trimmed.slice(6, 8);
  const h = trimmed.slice(8, 10);
  const mi = trimmed.slice(10, 12);
  const s = trimmed.slice(12, 14);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export function registerImproveFrontmatterTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "improve_frontmatter",
    {
      title: "Improve frontmatter",
      description:
        "Normalizes/adds required AILSS YAML frontmatter keys for a note (and normalizes typed-link keys when present). Requires AILSS_VAULT_PATH. No write occurs unless apply=true.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown note path (e.g. "Projects/Note.md")'),
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
        fix_identity: z
          .boolean()
          .default(false)
          .describe("If true, attempt to fix id/created mismatch (may rewrite identity fields)"),
      },
      outputSchema: z.object({
        path: z.string(),
        applied: z.boolean(),
        changed: z.boolean(),
        before_sha256: z.string(),
        after_sha256: z.string(),
        has_frontmatter: z.boolean(),
        missing_required_keys_before: z.array(z.string()),
        identity: z.object({
          id: z.string().nullable(),
          created: z.string().nullable(),
          id_matches_created: z.boolean(),
          fixed: z.boolean(),
        }),
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
        throw new Error("Cannot improve frontmatter because AILSS_VAULT_PATH is not set.");
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

        const hadFrontmatter = hasFrontmatterBlock(beforeText);
        const parsed = parseMarkdownNote(beforeText);
        const existingFm = parsed.frontmatter ?? {};

        const missingBefore: string[] = [];
        for (const key of REQUIRED_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(existingFm, key)) missingBefore.push(key);
        }

        const now = nowIsoSeconds();
        const preservedTitle = coerceNonEmptyString((existingFm as Record<string, unknown>).title);
        const title = preservedTitle ?? titleFromPath(args.path);

        const merged = buildAilssFrontmatter({ title, now, preserve: existingFm });

        // Normalize list-like keys to stable arrays.
        const mergedRecord = merged as Record<string, unknown>;
        mergedRecord.aliases = normalizeStringList(mergedRecord.aliases);
        mergedRecord.tags = normalizeStringList(mergedRecord.tags);
        mergedRecord.keywords = normalizeStringList(mergedRecord.keywords);
        mergedRecord.source = normalizeStringList(mergedRecord.source);

        for (const rel of AILSS_TYPED_LINK_KEYS) {
          const values = normalizeStringList(mergedRecord[rel]).map(toWikilink);
          mergedRecord[rel] = values;
        }

        // Coerce created/updated to ISO seconds when possible (avoid Date objects leaking into YAML).
        const createdRaw = coerceNonEmptyString(mergedRecord.created);
        if (createdRaw) mergedRecord.created = createdRaw.slice(0, 19);

        const updatedRaw = coerceNonEmptyString(mergedRecord.updated);
        if (updatedRaw) mergedRecord.updated = updatedRaw.slice(0, 19);

        let identityFixed = false;
        if (args.fix_identity) {
          const idRaw = coerceNonEmptyString(mergedRecord.id);
          const created = coerceNonEmptyString(mergedRecord.created);

          if (created) {
            const desiredId = idFromCreated(created);
            if (desiredId && desiredId !== idRaw) {
              mergedRecord.id = desiredId;
              identityFixed = true;
            }
          } else if (idRaw) {
            const desiredCreated = isoSecondsFromId(idRaw);
            if (desiredCreated) {
              mergedRecord.created = desiredCreated;
              identityFixed = true;
            }
          }
        }

        const afterTextPreview = renderMarkdownWithFrontmatter({
          frontmatter: mergedRecord,
          body: parsed.body,
        });

        const changedPreview = afterTextPreview !== beforeText;

        // Only bump `updated` when we are actually applying a change.
        let afterText = afterTextPreview;
        if (args.apply && changedPreview) {
          (mergedRecord as Record<string, unknown>).updated = now;
          afterText = renderMarkdownWithFrontmatter({
            frontmatter: mergedRecord,
            body: parsed.body,
          });
        }

        const afterSha256 = sha256HexUtf8(afterText);
        const changed = afterSha256 !== beforeSha256;

        const idValue = coerceNonEmptyString(mergedRecord.id);
        const createdValue = coerceNonEmptyString(mergedRecord.created);
        const createdId = createdValue ? idFromCreated(createdValue) : null;
        const idMatchesCreated = Boolean(
          idValue && createdId && /^\d{14}$/.test(idValue) && idValue === createdId,
        );

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
          has_frontmatter: hadFrontmatter,
          missing_required_keys_before: missingBefore,
          identity: {
            id: idValue,
            created: createdValue,
            id_matches_created: idMatchesCreated,
            fixed: identityFixed,
          },
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
