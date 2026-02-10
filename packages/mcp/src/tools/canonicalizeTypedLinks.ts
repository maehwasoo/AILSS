// canonicalize_typed_links tool
// - single-note frontmatter typed-link canonicalization

import { createHash } from "node:crypto";
import path from "node:path";

import {
  AILSS_TYPED_LINK_KEYS,
  isDefaultIgnoredVaultRelPath,
  parseMarkdownNote,
  resolveNotePathsByWikilinkTarget,
} from "@ailss/core";
import type { AilssDb, ResolvedNoteTarget } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";
import { readVaultFileFullText, writeVaultFileText } from "../lib/vaultFs.js";

type ReplacementEdit = {
  rel: string;
  index: number;
  before: string;
  after: string;
  target_before: string;
  target_after: string;
};

type UnresolvedItem = {
  rel: string;
  index: number;
  before: string;
  target: string;
};

type AmbiguousItem = {
  rel: string;
  index: number;
  before: string;
  target: string;
  candidates: Array<{
    path: string;
    title: string | null;
    matched_by: "path" | "note_id" | "title";
  }>;
};

type FrontmatterSplit = {
  body: string;
};

const MAX_REPORTED_CANDIDATES = 5;
const RESOLVE_LIMIT = 20;

function sha256HexUtf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeNewlines(input: string): string {
  return (input ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitFrontmatter(markdown: string): FrontmatterSplit | null {
  const normalized = normalizeNewlines(markdown);
  const input = normalized.startsWith("\ufeff") ? normalized.slice(1) : normalized;
  if (!input.startsWith("---\n")) return null;

  const lines = input.split("\n");
  if ((lines[0] ?? "") !== "---") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---" || line === "...") {
      end = i;
      break;
    }
  }

  if (end === -1) return null;

  return {
    body: lines.slice(end + 1).join("\n"),
  };
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (!value) return '""';
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    const serialized = yamlScalar(value);
    if (!serialized) lines.push(`${key}:`);
    else lines.push(`${key}: ${serialized}`);
  }
  return lines.join("\n");
}

function renderMarkdownWithFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${renderFrontmatterYaml(frontmatter)}\n---\n${body}`;
}

function removeMarkdownExtension(vaultRelPath: string): string {
  return vaultRelPath.toLowerCase().endsWith(".md") ? vaultRelPath.slice(0, -3) : vaultRelPath;
}

function splitTargetAndDisplay(raw: string): {
  target_for_resolution: string;
  display_for_canonical_link: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      target_for_resolution: "",
      display_for_canonical_link: "",
    };
  }

  const inner =
    trimmed.startsWith("[[") && trimmed.endsWith("]]") ? trimmed.slice(2, -2).trim() : trimmed;

  const pipeIndex = inner.indexOf("|");
  const left = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
  const right = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "").trim();
  const targetForResolution = left.split("#")[0]?.trim() ?? "";
  const displayForCanonicalLink = right || left || inner;

  return {
    target_for_resolution: targetForResolution || left || inner,
    display_for_canonical_link: displayForCanonicalLink,
  };
}

function resolveStrictPathTarget(
  db: AilssDb,
  target: string,
  limit: number,
): Array<{
  path: string;
  title: string | null;
  matchedBy: "path";
}> {
  const normalized = target.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized) return [];

  const withExt = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
  const rows = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE path = ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(withExt, limit) as Array<{ path: string; title: string | null }>;

  return rows.map((row) => ({ path: row.path, title: row.title, matchedBy: "path" }));
}

function resolveTargetCandidates(db: AilssDb, target: string): ResolvedNoteTarget[] {
  if (target.includes("/")) {
    return resolveStrictPathTarget(db, target, RESOLVE_LIMIT);
  }
  return resolveNotePathsByWikilinkTarget(db, target, RESOLVE_LIMIT);
}

function canonicalWikilink(pathNoExt: string, display: string): string {
  return `[[${pathNoExt}|${display}]]`;
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
        const nextFrontmatter: Record<string, unknown> = { ...frontmatter };

        const edits: ReplacementEdit[] = [];
        const unresolved: UnresolvedItem[] = [];
        const ambiguous: AmbiguousItem[] = [];

        const resolveCache = new Map<string, ResolvedNoteTarget[]>();
        const resolveCached = (target: string): ResolvedNoteTarget[] => {
          const key = target.trim();
          if (!key) return [];
          if (resolveCache.has(key)) return resolveCache.get(key) ?? [];
          const resolved = resolveTargetCandidates(deps.db, key);
          resolveCache.set(key, resolved);
          return resolved;
        };

        for (const rel of AILSS_TYPED_LINK_KEYS) {
          const current = frontmatter[rel];

          if (typeof current === "string") {
            const { target_for_resolution, display_for_canonical_link } =
              splitTargetAndDisplay(current);
            if (!target_for_resolution) continue;

            const resolved = resolveCached(target_for_resolution);
            if (resolved.length === 1) {
              const canonicalTarget = removeMarkdownExtension(resolved[0]!.path);
              const after = canonicalWikilink(canonicalTarget, display_for_canonical_link);
              if (after !== current) {
                nextFrontmatter[rel] = after;
                edits.push({
                  rel,
                  index: 0,
                  before: current,
                  after,
                  target_before: target_for_resolution,
                  target_after: canonicalTarget,
                });
              }
              continue;
            }

            if (resolved.length === 0) {
              unresolved.push({
                rel,
                index: 0,
                before: current,
                target: target_for_resolution,
              });
              continue;
            }

            ambiguous.push({
              rel,
              index: 0,
              before: current,
              target: target_for_resolution,
              candidates: resolved.slice(0, MAX_REPORTED_CANDIDATES).map((candidate) => ({
                path: candidate.path,
                title: candidate.title,
                matched_by: candidate.matchedBy,
              })),
            });
            continue;
          }

          if (!Array.isArray(current)) continue;

          const nextArray = [...current];
          let arrayChanged = false;

          for (const [index, entry] of current.entries()) {
            if (typeof entry !== "string") continue;

            const { target_for_resolution, display_for_canonical_link } =
              splitTargetAndDisplay(entry);
            if (!target_for_resolution) continue;

            const resolved = resolveCached(target_for_resolution);
            if (resolved.length === 1) {
              const canonicalTarget = removeMarkdownExtension(resolved[0]!.path);
              const after = canonicalWikilink(canonicalTarget, display_for_canonical_link);
              if (after !== entry) {
                nextArray[index] = after;
                arrayChanged = true;
                edits.push({
                  rel,
                  index,
                  before: entry,
                  after,
                  target_before: target_for_resolution,
                  target_after: canonicalTarget,
                });
              }
              continue;
            }

            if (resolved.length === 0) {
              unresolved.push({
                rel,
                index,
                before: entry,
                target: target_for_resolution,
              });
              continue;
            }

            ambiguous.push({
              rel,
              index,
              before: entry,
              target: target_for_resolution,
              candidates: resolved.slice(0, MAX_REPORTED_CANDIDATES).map((candidate) => ({
                path: candidate.path,
                title: candidate.title,
                matched_by: candidate.matchedBy,
              })),
            });
          }

          if (arrayChanged) {
            nextFrontmatter[rel] = nextArray;
          }
        }

        let afterText = beforeText;
        if (edits.length > 0 && split) {
          afterText = renderMarkdownWithFrontmatter(nextFrontmatter, split.body);
        }

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
          await writeVaultFileText({ vaultPath, vaultRelPath: args.path, text: afterText });

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
          edits,
          unresolved,
          ambiguous,
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
