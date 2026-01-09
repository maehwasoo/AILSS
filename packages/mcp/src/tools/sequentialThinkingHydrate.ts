// sequentialthinking_hydrate tool
// - loads a sequentialthinking session note plus recent thought notes
// - DB-backed session_note_id resolve + title-based thought resolution with filesystem fallback

import path from "node:path";

import {
  isDefaultIgnoredVaultRelPath,
  parseMarkdownNote,
  resolveNotePathsByWikilinkTarget,
  searchNotes,
  wikilinkTarget,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { readVaultFileFullText } from "../lib/vaultFs.js";

function dirnamePosix(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "." ? "" : dir;
}

function sanitizeFileStemFromTitle(title: string): string {
  const trimmed = title.trim();
  const noSeparators = trimmed.replace(/[\\/]+/g, "-");
  const collapsed = noSeparators.replace(/\s+/g, " ").trim();
  const shortened = collapsed.length > 120 ? collapsed.slice(0, 120).trim() : collapsed;
  return shortened || "Untitled";
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

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const limit = Math.max(1, maxChars);
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export function registerSequentialThinkingHydrateTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "sequentialthinking_hydrate",
    {
      title: "Sequential Thinking hydrate (vault-backed)",
      description: [
        "Loads a sequentialthinking session note and recent thought notes as a context bundle.",
        "Session resolution uses DB (session_note_id → path), so the session note must be indexed.",
        "Thought resolution prefers DB by title/path and falls back to the session folder when possible.",
      ].join(" "),
      inputSchema: {
        session_note_id: z
          .string()
          .min(1)
          .describe("Session note frontmatter id (note_id) — stable resume key across relocates"),
        session_path: z
          .string()
          .min(1)
          .optional()
          .describe("Optional session note path (vault-relative). Used as a direct fallback."),
        thought_scope: z
          .union([z.literal("latest"), z.literal("all")])
          .default("latest")
          .describe(
            'Whether to return only the "latest" thought notes or "all" linked thought notes',
          ),
        max_thought_notes: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(10)
          .describe("Maximum number of thought notes returned (safety bound)"),
        max_chars_per_note: z
          .number()
          .int()
          .min(200)
          .max(50_000)
          .default(10_000)
          .describe("Maximum characters returned per note (session + each thought)"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum resolved note paths per thought wikilink target"),
      },
      outputSchema: z.object({
        session_note_id: z.string(),
        session_path: z.string(),
        session_title: z.string(),
        params: z.object({
          thought_scope: z.union([z.literal("latest"), z.literal("all")]),
          max_thought_notes: z.number().int(),
          max_chars_per_note: z.number().int(),
          max_resolutions_per_target: z.number().int(),
        }),
        session: z.object({
          path: z.string(),
          note_id: z.string().nullable(),
          title: z.string().nullable(),
          truncated: z.boolean(),
          content: z.string(),
          see_also: z.array(z.string()),
          branch_ids: z.array(z.string()),
        }),
        thoughts: z.array(
          z.object({
            path: z.string(),
            matched_by: z.union([z.literal("path"), z.literal("title"), z.literal("guessed_path")]),
            note_id: z.string().nullable(),
            title: z.string().nullable(),
            thought_number: z.number().int().nullable(),
            truncated: z.boolean(),
            content: z.string(),
          }),
        ),
        unresolved_targets: z.array(z.string()),
        ambiguous_targets: z.array(
          z.object({
            target: z.string(),
            candidates: z.array(
              z.object({
                path: z.string(),
                title: z.string().nullable(),
                matched_by: z.union([z.literal("path"), z.literal("title")]),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      if (!deps.vaultPath) {
        throw new Error(
          "Cannot hydrate sequentialthinking sessions because AILSS_VAULT_PATH is not set.",
        );
      }

      const sessionNoteId = String(args.session_note_id ?? "").trim();
      if (!sessionNoteId) {
        throw new Error("session_note_id is empty after trimming.");
      }

      let sessionPath = "";
      let sessionTitle = "";

      if (args.session_path) {
        sessionPath = args.session_path.split("\\").join("/");
        if (path.posix.extname(sessionPath).toLowerCase() !== ".md") {
          throw new Error(`Refusing non-markdown session_path: "${args.session_path}"`);
        }
      } else {
        const matches = searchNotes(deps.db, { noteId: sessionNoteId, limit: 5 });
        if (matches.length === 0) {
          throw new Error(
            [
              `Session note not found for session_note_id="${sessionNoteId}".`,
              "This lookup is DB-backed, so the note must be indexed.",
              "Fix: reindex the vault (or pass session_path).",
            ].join(" "),
          );
        }
        if (matches.length > 1) {
          const paths = matches.map((m) => m.path).join(", ");
          throw new Error(
            [
              `Multiple notes found for session_note_id="${sessionNoteId}".`,
              `paths=[${paths}]`,
              "Fix: pass session_path to disambiguate, or repair duplicated frontmatter.id values.",
            ].join(" "),
          );
        }

        sessionPath = matches[0]?.path ?? "";
        if (!sessionPath) {
          throw new Error(`Resolved empty path for session_note_id="${sessionNoteId}".`);
        }
        sessionTitle = String(matches[0]?.title ?? "").trim();
      }

      const sessionTextFull = await readVaultFileFullText({
        vaultPath: deps.vaultPath,
        vaultRelPath: sessionPath,
      });
      const sessionParsed = parseMarkdownNote(sessionTextFull);
      const parsedSessionId = toNullableString(sessionParsed.frontmatter.id);
      if (parsedSessionId && parsedSessionId !== sessionNoteId) {
        throw new Error(
          [
            "Session note id mismatch.",
            `session_note_id="${sessionNoteId}"`,
            `resolved_path="${sessionPath}"`,
            `file_frontmatter.id="${parsedSessionId}"`,
            "Fix: pass the correct session_note_id, or reindex the vault DB if it is stale.",
          ].join(" "),
        );
      }

      const parsedSessionTitle =
        toNullableString(sessionParsed.frontmatter.title) ?? sessionTitle ?? null;
      sessionTitle = parsedSessionTitle ?? path.posix.basename(sessionPath, ".md");

      const sessionSeeAlso = coerceStringList(sessionParsed.frontmatter.see_also);
      const sessionBranchIds = coerceStringList(sessionParsed.frontmatter.branch_ids);

      const selectedWikilinks =
        args.thought_scope === "all"
          ? sessionSeeAlso
          : sessionSeeAlso.slice(Math.max(0, sessionSeeAlso.length - args.max_thought_notes));

      const sessionDir = dirnamePosix(sessionPath);

      const thoughts: Array<{
        path: string;
        matched_by: "path" | "title" | "guessed_path";
        note_id: string | null;
        title: string | null;
        thought_number: number | null;
        truncated: boolean;
        content: string;
      }> = [];

      const unresolvedTargets: string[] = [];
      const ambiguousTargets: Array<{
        target: string;
        candidates: Array<{ path: string; title: string | null; matched_by: "path" | "title" }>;
      }> = [];

      for (const wikilink of selectedWikilinks) {
        const target = wikilinkTarget(wikilink);
        if (!target) continue;

        const resolved = resolveNotePathsByWikilinkTarget(
          deps.db,
          target,
          args.max_resolutions_per_target,
        );

        const guessedPath = sessionDir
          ? path.posix.join(sessionDir, `${sanitizeFileStemFromTitle(target)}.md`)
          : `${sanitizeFileStemFromTitle(target)}.md`;

        const canGuessPath =
          guessedPath &&
          path.posix.extname(guessedPath).toLowerCase() === ".md" &&
          !isDefaultIgnoredVaultRelPath(guessedPath);

        // Prefer unambiguous DB resolution; otherwise try a deterministic filesystem guess
        // based on the default sequentialthinking layout.
        let chosen: { path: string; matched_by: "path" | "title" | "guessed_path" } | null = null;

        if (resolved.length === 1) {
          chosen = { path: resolved[0]?.path ?? "", matched_by: resolved[0]?.matchedBy ?? "title" };
        } else if (canGuessPath) {
          try {
            await readVaultFileFullText({ vaultPath: deps.vaultPath, vaultRelPath: guessedPath });
            chosen = { path: guessedPath, matched_by: "guessed_path" };
          } catch {
            // ignore, handled below
          }
        }

        if (!chosen || !chosen.path) {
          if (resolved.length === 0) {
            unresolvedTargets.push(target);
          } else {
            ambiguousTargets.push({
              target,
              candidates: resolved.map((r) => ({
                path: r.path,
                title: r.title,
                matched_by: r.matchedBy,
              })),
            });
          }
          continue;
        }

        const thoughtTextFull = await readVaultFileFullText({
          vaultPath: deps.vaultPath,
          vaultRelPath: chosen.path,
        });
        const thoughtParsed = parseMarkdownNote(thoughtTextFull);
        const { text: thoughtText, truncated: thoughtTruncated } = truncateText(
          thoughtTextFull,
          args.max_chars_per_note,
        );

        const thoughtId = toNullableString(thoughtParsed.frontmatter.id);
        const thoughtTitle = toNullableString(thoughtParsed.frontmatter.title);
        const thoughtNumber = toNullableInt(thoughtParsed.frontmatter.thought_number);

        thoughts.push({
          path: chosen.path,
          matched_by: chosen.matched_by,
          note_id: thoughtId,
          title: thoughtTitle,
          thought_number: thoughtNumber,
          truncated: thoughtTruncated,
          content: thoughtText,
        });
      }

      const { text: sessionText, truncated: sessionTruncated } = truncateText(
        sessionTextFull,
        args.max_chars_per_note,
      );

      const payload = {
        session_note_id: sessionNoteId,
        session_path: sessionPath,
        session_title: sessionTitle,
        params: {
          thought_scope: args.thought_scope,
          max_thought_notes: args.max_thought_notes,
          max_chars_per_note: args.max_chars_per_note,
          max_resolutions_per_target: args.max_resolutions_per_target,
        },
        session: {
          path: sessionPath,
          note_id: parsedSessionId,
          title: toNullableString(sessionParsed.frontmatter.title),
          truncated: sessionTruncated,
          content: sessionText,
          see_also: sessionSeeAlso,
          branch_ids: sessionBranchIds,
        },
        thoughts,
        unresolved_targets: unresolvedTargets,
        ambiguous_targets: ambiguousTargets,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
