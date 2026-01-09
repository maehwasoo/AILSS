// sequentialthinking tool (vault-backed)
// - records each thought as a linked Obsidian note (explicit apply)
// - persists session state in vault frontmatter (branch_ids, see_also)

import { promises as fs } from "node:fs";
import path from "node:path";

import { isDefaultIgnoredVaultRelPath, parseMarkdownNote, toWikilink } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import {
  buildAilssFrontmatter,
  defaultTagsForRelPath,
  idFromIsoSeconds,
  nowIsoSeconds,
  renderMarkdownWithFrontmatter,
} from "../lib/ailssNoteTemplate.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";
import {
  readVaultFileFullText,
  resolveVaultPathSafely,
  writeVaultFileText,
} from "../lib/vaultFs.js";

type ThoughtData = {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  nextThoughtNeeded: boolean;
};

function sanitizeFileStemFromTitle(title: string): string {
  const trimmed = title.trim();
  const noSeparators = trimmed.replace(/[\\/]+/g, "-");
  const collapsed = noSeparators.replace(/\s+/g, " ").trim();
  const shortened = collapsed.length > 120 ? collapsed.slice(0, 120).trim() : collapsed;
  return shortened || "Untitled";
}

function padThoughtNumber(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return String(n);
  if (n < 10) return `00${n}`;
  if (n < 100) return `0${n}`;
  return String(n);
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

  const now = nowIsoSeconds();
  const fallback = tryRel(`-${now.replace(/[-:T]/g, "").slice(0, 14)}`);
  if (isDefaultIgnoredVaultRelPath(fallback)) {
    throw new Error(`Refusing to create note in ignored folder: path="${fallback}"`);
  }
  return fallback;
}

function normalizeFolderPath(input: string): string {
  const normalized = input.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized;
}

function dirnamePosix(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "." ? "" : dir;
}

function mergeStringListUnique(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...a, ...b]) {
    const trimmed = (v ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function buildThoughtNoteBody(options: {
  title: string;
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
}): string {
  const lines: string[] = [];

  lines.push(`# ${options.title}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- 단계: ${options.thoughtNumber}/${options.totalThoughts}`);
  lines.push(`- 다음 단계 필요: ${options.nextThoughtNeeded ? "예" : "아니요"}`);

  if (options.isRevision) {
    lines.push(
      `- 수정: ${typeof options.revisesThought === "number" ? options.revisesThought : "예"}`,
    );
  }
  if (typeof options.branchFromThought === "number") {
    lines.push(
      `- 분기: ${options.branchFromThought}${options.branchId ? ` (${options.branchId})` : ""}`,
    );
  }

  lines.push("");
  lines.push("## Core");
  lines.push(options.thought.trim() ? options.thought.trim() : "(empty)");
  lines.push("");
  lines.push("## Next actions");
  lines.push("- TODO");
  lines.push("");

  return lines.join("\n");
}

function buildSessionNoteBody(options: { title: string }): string {
  return [
    `# ${options.title}`,
    "",
    "## Summary",
    "- 이 노트는 순차적 추론 기록이에요.",
    "- `see_also`에 각 생각 노트가 연결돼요.",
    "",
    "## Next actions",
    "- TODO",
    "",
  ].join("\n");
}

function coerceStringList(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((v) => (typeof v === "string" ? [v] : []))
    .map((v) => v.trim())
    .filter(Boolean);
}

export function registerSequentialThinkingVaultTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "sequentialthinking",
    {
      title: "Sequential Thinking (vault-backed)",
      description: [
        "Records a step-by-step thinking process as linked Obsidian notes in the vault.",
        "Safety: requires AILSS_ENABLE_WRITE_TOOLS=1 and apply=true to write.",
        "Guidance: keep thought text as a short, safe step-summary (avoid secrets and verbose internal chain-of-thought).",
      ].join(" "),
      inputSchema: {
        thought: z.string().describe("Your current thinking step (recommended: safe step-summary)"),
        nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
        thoughtNumber: z.number().int().min(1).describe("Current thought number (e.g., 1, 2, 3)"),
        totalThoughts: z.number().int().min(1).describe("Estimated total thoughts (e.g., 5, 10)"),
        isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
        revisesThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Which thought is being reconsidered"),
        branchFromThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Branching point thought number"),
        branchId: z.string().optional().describe("Branch identifier"),
        needsMoreThoughts: z.boolean().optional().describe("If more thoughts are needed"),
        session_path: z
          .string()
          .min(1)
          .optional()
          .describe("Existing session note path (vault-relative), returned by earlier calls"),
        session_title: z
          .string()
          .default("")
          .describe("Optional session title used when creating a new session note"),
        folder: z
          .string()
          .default("100. Inbox/10. 추론 세션(Reasoning Sessions)")
          .describe("Vault-relative folder used when creating a new session note"),
        apply: z.boolean().default(false).describe("Apply file write; false = dry-run"),
        reindex_after_apply: z
          .boolean()
          .default(false)
          .describe("If apply=true, also reindex written paths into the DB (may cost money)"),
      },
      outputSchema: z.object({
        applied: z.boolean(),
        session_path: z.string(),
        session_title: z.string(),
        session_created: z.boolean(),
        thought_path: z.string(),
        thought_title: z.string(),
        thought_number: z.number().int(),
        total_thoughts: z.number().int(),
        next_thought_needed: z.boolean(),
        branches: z.array(z.string()),
        thought_history_length: z.number().int().nonnegative(),
        notes_written: z.array(z.string()),
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
        throw new Error("Cannot record thoughts because AILSS_VAULT_PATH is not set.");
      }

      const input: ThoughtData = {
        thought: args.thought,
        thoughtNumber: args.thoughtNumber,
        totalThoughts: args.totalThoughts,
        isRevision: args.isRevision,
        revisesThought: args.revisesThought,
        branchFromThought: args.branchFromThought,
        branchId: args.branchId,
        needsMoreThoughts: args.needsMoreThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
      };

      const run = async () => {
        const now = nowIsoSeconds();

        const adjustedTotal =
          input.thoughtNumber > input.totalThoughts ? input.thoughtNumber : input.totalThoughts;

        let sessionCreated = false;
        let sessionTitle = "";
        let sessionPath = "";
        let sessionId = "";

        const notesWritten: string[] = [];

        if (args.session_path) {
          sessionPath = args.session_path.split("\\").join("/");
          if (path.posix.extname(sessionPath).toLowerCase() !== ".md") {
            throw new Error(`Refusing non-markdown session_path: "${args.session_path}"`);
          }
          const existing = await readVaultFileFullText({ vaultPath, vaultRelPath: sessionPath });
          const parsed = parseMarkdownNote(existing);
          sessionTitle =
            String(parsed.frontmatter.title ?? "").trim() ||
            path.posix.basename(sessionPath, ".md");
          sessionId =
            String(parsed.frontmatter.session_id ?? "").trim() ||
            String(parsed.frontmatter.id ?? "").trim() ||
            idFromIsoSeconds(now);
        } else {
          sessionCreated = true;
          sessionId = idFromIsoSeconds(now);
          const providedTitle = (args.session_title ?? "").trim();
          sessionTitle = providedTitle || `추론 세션(Reasoning Session) ${sessionId}`;

          const sessionStem = sanitizeFileStemFromTitle(sessionTitle);
          const folder = normalizeFolderPath(args.folder);
          sessionPath = await findAvailablePath({ vaultPath, folder, stem: sessionStem });
        }

        if (isDefaultIgnoredVaultRelPath(sessionPath)) {
          throw new Error(`Refusing to write in ignored folder: path="${sessionPath}"`);
        }

        const sessionDir = dirnamePosix(sessionPath);
        const thoughtTitle = `생각(Thought) ${sessionId} T${padThoughtNumber(input.thoughtNumber)}`;
        const thoughtStem = sanitizeFileStemFromTitle(thoughtTitle);
        const thoughtPath = sessionDir
          ? path.posix.join(sessionDir, `${thoughtStem}.md`)
          : `${thoughtStem}.md`;

        if (isDefaultIgnoredVaultRelPath(thoughtPath)) {
          throw new Error(`Refusing to write in ignored folder: path="${thoughtPath}"`);
        }

        // Title-based links (stable under relocate_note path moves)
        const sessionWikilink = toWikilink(sessionTitle);
        const thoughtWikilink = toWikilink(thoughtTitle);

        const dependsOn: string[] = [];
        if (input.thoughtNumber > 1) {
          const prevTitle = `생각(Thought) ${sessionId} T${padThoughtNumber(input.thoughtNumber - 1)}`;
          dependsOn.push(toWikilink(prevTitle));
        }

        if (typeof input.branchFromThought === "number" && input.branchFromThought >= 1) {
          const fromTitle = `생각(Thought) ${sessionId} T${padThoughtNumber(input.branchFromThought)}`;
          dependsOn.push(toWikilink(fromTitle));
        }

        const supersedes: string[] = [];
        if (
          input.isRevision &&
          typeof input.revisesThought === "number" &&
          input.revisesThought >= 1
        ) {
          const oldTitle = `생각(Thought) ${sessionId} T${padThoughtNumber(input.revisesThought)}`;
          supersedes.push(toWikilink(oldTitle));
        }

        const thoughtFrontmatter = buildAilssFrontmatter({
          title: thoughtTitle,
          now,
          tags: mergeStringListUnique(defaultTagsForRelPath(thoughtPath), ["ailss", "thinking"]),
          overrides: {
            entity: "log",
            layer: "operational",
            part_of: [sessionWikilink],
            depends_on: dependsOn,
            supersedes: supersedes,
            session_id: sessionId,
            thought_number: input.thoughtNumber,
            total_thoughts: adjustedTotal,
            next_thought_needed: input.nextThoughtNeeded,
            is_revision: Boolean(input.isRevision),
            revises_thought: input.revisesThought ?? null,
            branch_from_thought: input.branchFromThought ?? null,
            branch_id: input.branchId ?? null,
          },
        });

        const thoughtBody = buildThoughtNoteBody({
          title: thoughtTitle,
          thought: input.thought,
          thoughtNumber: input.thoughtNumber,
          totalThoughts: adjustedTotal,
          nextThoughtNeeded: input.nextThoughtNeeded,
          isRevision: input.isRevision,
          revisesThought: input.revisesThought,
          branchFromThought: input.branchFromThought,
          branchId: input.branchId,
        });

        const thoughtMarkdown = renderMarkdownWithFrontmatter({
          frontmatter: thoughtFrontmatter,
          body: thoughtBody,
        });

        let sessionMarkdown: string | null = null;
        if (sessionCreated) {
          const sessionFrontmatter = buildAilssFrontmatter({
            title: sessionTitle,
            now,
            tags: mergeStringListUnique(defaultTagsForRelPath(sessionPath), ["ailss", "thinking"]),
            overrides: {
              entity: "log",
              layer: "operational",
              session_id: sessionId,
              see_also: [thoughtWikilink],
              branch_ids: input.branchId ? [input.branchId] : [],
            },
          });
          const sessionBody = buildSessionNoteBody({ title: sessionTitle });
          sessionMarkdown = renderMarkdownWithFrontmatter({
            frontmatter: sessionFrontmatter,
            body: sessionBody,
          });
        } else {
          const sessionText = await readVaultFileFullText({ vaultPath, vaultRelPath: sessionPath });
          const parsed = parseMarkdownNote(sessionText);
          const existingSeeAlso = coerceStringList(parsed.frontmatter.see_also);
          const nextSeeAlso = mergeStringListUnique(existingSeeAlso, [thoughtWikilink]);
          const existingBranchIds = coerceStringList(parsed.frontmatter.branch_ids);
          const nextBranchIds = input.branchId
            ? mergeStringListUnique(existingBranchIds, [input.branchId])
            : existingBranchIds;
          const nextFrontmatter = buildAilssFrontmatter({
            title: String(parsed.frontmatter.title ?? sessionTitle) || sessionTitle,
            now,
            preserve: parsed.frontmatter,
            overrides: {
              see_also: nextSeeAlso,
              session_id: sessionId,
              branch_ids: nextBranchIds,
              updated: now,
            },
          });
          sessionMarkdown = renderMarkdownWithFrontmatter({
            frontmatter: nextFrontmatter,
            body: parsed.body ?? "",
          });
        }

        if (!args.apply) {
          const payload = {
            applied: false,
            session_path: sessionPath,
            session_title: sessionTitle,
            session_created: sessionCreated,
            thought_path: thoughtPath,
            thought_title: thoughtTitle,
            thought_number: input.thoughtNumber,
            total_thoughts: adjustedTotal,
            next_thought_needed: input.nextThoughtNeeded,
            branches: input.branchId ? [input.branchId] : [],
            thought_history_length: 0,
            notes_written: [],
            reindexed: false,
            reindex_summary: null,
            reindex_error: null,
            // Debug hashes (not in schema): intentionally omitted to keep API stable.
          };

          return {
            structuredContent: payload,
            content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          };
        }

        // Writes
        const sessionAbs = resolveVaultPathSafely(vaultPath, sessionPath);
        await fs.mkdir(path.dirname(sessionAbs), { recursive: true });

        const thoughtAbs = resolveVaultPathSafely(vaultPath, thoughtPath);
        await fs.mkdir(path.dirname(thoughtAbs), { recursive: true });
        if (await fileExists(thoughtAbs)) {
          throw new Error(
            `Refusing to overwrite existing thought note. path="${thoughtPath}" (thoughtNumber must be unique per session)`,
          );
        }

        if (sessionCreated && sessionMarkdown) {
          await writeVaultFileText({ vaultPath, vaultRelPath: sessionPath, text: sessionMarkdown });
          notesWritten.push(sessionPath);
        }

        await writeVaultFileText({ vaultPath, vaultRelPath: thoughtPath, text: thoughtMarkdown });
        notesWritten.push(thoughtPath);

        if (!sessionCreated && sessionMarkdown) {
          await writeVaultFileText({ vaultPath, vaultRelPath: sessionPath, text: sessionMarkdown });
          notesWritten.push(sessionPath);
        }

        let reindexed = false;
        let reindexSummary: {
          changed_files: number;
          indexed_chunks: number;
          deleted_files: number;
        } | null = null;
        let reindexError: string | null = null;

        if (args.reindex_after_apply) {
          try {
            const summary = await reindexVaultPaths(deps, notesWritten);
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

        const finalSessionText = await readVaultFileFullText({
          vaultPath,
          vaultRelPath: sessionPath,
        });
        const finalSessionParsed = parseMarkdownNote(finalSessionText);
        const finalSeeAlso = coerceStringList(finalSessionParsed.frontmatter.see_also);
        const finalBranchIds = coerceStringList(finalSessionParsed.frontmatter.branch_ids);

        const payload = {
          applied: true,
          session_path: sessionPath,
          session_title: sessionTitle,
          session_created: sessionCreated,
          thought_path: thoughtPath,
          thought_title: thoughtTitle,
          thought_number: input.thoughtNumber,
          total_thoughts: adjustedTotal,
          next_thought_needed: input.nextThoughtNeeded,
          branches: finalBranchIds.sort((a, b) => a.localeCompare(b)),
          thought_history_length: finalSeeAlso.length,
          notes_written: notesWritten,
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
