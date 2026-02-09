// frontmatter_validate tool
// - filesystem scan + YAML frontmatter presence checks

import {
  AILSS_TYPED_LINK_ONTOLOGY_BY_REL,
  listMarkdownFiles,
  normalizeAilssNoteMeta,
  parseMarkdownNote,
} from "@ailss/core";
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
  "source",
] as const;

const TYPED_LINK_CONSTRAINT_MODES = ["off", "warn", "error"] as const;
type TypedLinkConstraintMode = (typeof TYPED_LINK_CONSTRAINT_MODES)[number];

type TypedLinkRecord = {
  rel: string;
  to_target: string;
  to_wikilink: string;
  position: number;
};

type ScannedNote = {
  path: string;
  has_frontmatter: boolean;
  parsed_frontmatter: boolean;
  missing_keys: string[];
  id_value: string | null;
  created_value: string | null;
  id_format_ok: boolean;
  created_format_ok: boolean;
  id_matches_created: boolean;
  note_id: string | null;
  title: string | null;
  entity: string | null;
  typed_links: TypedLinkRecord[];
};

type TypedLinkDiagnostic = {
  path: string;
  rel: string;
  target: string | null;
  reason: string;
  fix_hint: string;
  severity: "warn" | "error";
};

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

function normalizeEntity(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeValueForLookup(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function collectTypedLinkDiagnostics(
  notes: ScannedNote[],
  mode: Exclude<TypedLinkConstraintMode, "off">,
): TypedLinkDiagnostic[] {
  const noteIdIndex = new Map<string, ScannedNote[]>();
  const titleIndex = new Map<string, ScannedNote[]>();

  const parseableNotes = notes.filter((note) => note.parsed_frontmatter);

  for (const note of parseableNotes) {
    const noteId = normalizeValueForLookup(note.note_id);
    if (noteId) {
      const existing = noteIdIndex.get(noteId) ?? [];
      existing.push(note);
      noteIdIndex.set(noteId, existing);
    }

    const title = normalizeValueForLookup(note.title);
    if (title) {
      const existing = titleIndex.get(title) ?? [];
      existing.push(note);
      titleIndex.set(title, existing);
    }
  }

  const resolveTargetEntity = (
    target: string,
  ): { status: "unresolved" | "ambiguous" | "resolved"; entity: string | null } => {
    const trimmed = target.trim();
    if (!trimmed) return { status: "unresolved", entity: null };

    const targetNoExt = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
    const targetWithExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;

    const matches: ScannedNote[] = [];
    const seenPaths = new Set<string>();
    const addMatch = (candidate: ScannedNote): void => {
      if (seenPaths.has(candidate.path)) return;
      seenPaths.add(candidate.path);
      matches.push(candidate);
    };

    for (const note of parseableNotes) {
      if (note.path === targetWithExt || note.path.endsWith(`/${targetWithExt}`)) addMatch(note);
    }

    for (const note of noteIdIndex.get(targetNoExt) ?? []) addMatch(note);
    for (const note of titleIndex.get(targetNoExt) ?? []) addMatch(note);

    if (matches.length === 0) return { status: "unresolved", entity: null };
    if (matches.length >= 2) return { status: "ambiguous", entity: null };
    return { status: "resolved", entity: normalizeEntity(matches[0]?.entity ?? null) };
  };

  const severity: "warn" | "error" = mode === "error" ? "error" : "warn";
  const diagnostics: TypedLinkDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const pushDiagnostic = (diag: TypedLinkDiagnostic): void => {
    const key = `${diag.path}\u0000${diag.rel}\u0000${diag.target ?? ""}\u0000${diag.reason}`;
    if (seenDiagnostics.has(key)) return;
    seenDiagnostics.add(key);
    diagnostics.push(diag);
  };

  for (const note of parseableNotes) {
    if (note.typed_links.length === 0) continue;

    const sourceEntity = normalizeEntity(note.entity);
    const targetsByRel = new Map<string, Set<string>>();

    for (const link of note.typed_links) {
      const rel = link.rel.trim();
      if (!rel) continue;
      const target = link.to_target.trim();
      const targets = targetsByRel.get(rel) ?? new Set<string>();
      if (target) targets.add(target);
      targetsByRel.set(rel, targets);
    }

    for (const [rel, targets] of targetsByRel) {
      const ontology =
        AILSS_TYPED_LINK_ONTOLOGY_BY_REL[rel as keyof typeof AILSS_TYPED_LINK_ONTOLOGY_BY_REL];
      const constraints = ontology && "constraints" in ontology ? ontology.constraints : undefined;
      if (!constraints) continue;

      if (typeof constraints.maxTargets === "number" && targets.size > constraints.maxTargets) {
        pushDiagnostic({
          path: note.path,
          rel,
          target: null,
          reason: `cardinality exceeded: ${targets.size} targets (max ${constraints.maxTargets})`,
          fix_hint: `Keep at most ${constraints.maxTargets} target(s) for \`${rel}\`.`,
          severity,
        });
      }

      if (constraints.sourceEntities?.length && sourceEntity) {
        const allowedSourceEntities = constraints.sourceEntities.map((entity: string) =>
          entity.toLowerCase(),
        );
        if (!allowedSourceEntities.includes(sourceEntity)) {
          pushDiagnostic({
            path: note.path,
            rel,
            target: null,
            reason: `source entity "${sourceEntity}" is incompatible with relation "${rel}"`,
            fix_hint: `Use one of: ${constraints.sourceEntities.join(", ")}, or move this link to a compatible note.`,
            severity,
          });
        }
      }

      if (constraints.conflictsWith?.length) {
        for (const conflictRel of constraints.conflictsWith) {
          const conflictTargets = targetsByRel.get(conflictRel) ?? new Set<string>();
          for (const target of targets) {
            if (!conflictTargets.has(target)) continue;
            pushDiagnostic({
              path: note.path,
              rel,
              target,
              reason: `conflict: same target appears in both "${rel}" and "${conflictRel}"`,
              fix_hint: `Keep "${target}" in only one of the two relations.`,
              severity,
            });
          }
        }
      }
    }

    for (const link of note.typed_links) {
      const rel = link.rel.trim();
      if (!rel) continue;

      const target = link.to_target.trim();
      if (!target) continue;

      const ontology =
        AILSS_TYPED_LINK_ONTOLOGY_BY_REL[rel as keyof typeof AILSS_TYPED_LINK_ONTOLOGY_BY_REL];
      const constraints = ontology && "constraints" in ontology ? ontology.constraints : undefined;
      if (!constraints?.targetEntities || constraints.targetEntities.length === 0) continue;

      const resolved = resolveTargetEntity(target);
      if (resolved.status !== "resolved") continue;

      const targetEntity = normalizeEntity(resolved.entity);
      if (!targetEntity) continue;

      const allowedTargetEntities = constraints.targetEntities.map((entity: string) =>
        entity.toLowerCase(),
      );
      if (allowedTargetEntities.includes(targetEntity)) continue;

      pushDiagnostic({
        path: note.path,
        rel,
        target,
        reason: `target entity "${targetEntity}" is incompatible with relation "${rel}"`,
        fix_hint: `Point \`${rel}\` to one of: ${constraints.targetEntities.join(", ")}.`,
        severity,
      });
    }
  }

  return diagnostics;
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
        typed_link_constraint_mode: z
          .enum(TYPED_LINK_CONSTRAINT_MODES)
          .default("warn")
          .describe(
            "Typed-link constraint mode: off (skip), warn (report diagnostics), error (count diagnostics as validation failures).",
          ),
      },
      outputSchema: z.object({
        path_prefix: z.string().nullable(),
        files_scanned: z.number().int().nonnegative(),
        ok_count: z.number().int().nonnegative(),
        issue_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        typed_link_constraint_mode: z.enum(TYPED_LINK_CONSTRAINT_MODES),
        typed_link_diagnostic_count: z.number().int().nonnegative(),
        typed_link_diagnostics: z.array(
          z.object({
            path: z.string(),
            rel: z.string(),
            target: z.string().nullable(),
            reason: z.string(),
            fix_hint: z.string(),
            severity: z.union([z.literal("warn"), z.literal("error")]),
          }),
        ),
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
            typed_link_diagnostics: z.array(
              z.object({
                path: z.string(),
                rel: z.string(),
                target: z.string().nullable(),
                reason: z.string(),
                fix_hint: z.string(),
                severity: z.union([z.literal("warn"), z.literal("error")]),
              }),
            ),
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

      const scannedNotes: ScannedNote[] = [];

      let filesScanned = 0;
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
        const normalizedMeta = normalizeAilssNoteMeta(fm);

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

        // Frontmatter parse status
        const parsedFrontmatter = hasFm && Object.keys(fm).length > 0;
        scannedNotes.push({
          path: relPath,
          has_frontmatter: hasFm,
          parsed_frontmatter: parsedFrontmatter,
          missing_keys: missing,
          id_value: idValue,
          created_value: createdValue,
          id_format_ok: idFormatOk,
          created_format_ok: createdFormatOk,
          id_matches_created: idMatchesCreated,
          note_id: normalizedMeta.noteId,
          title: normalizedMeta.title,
          entity: normalizeEntity(normalizedMeta.entity),
          typed_links: normalizedMeta.typedLinks.map((link) => ({
            rel: link.rel,
            to_target: link.toTarget,
            to_wikilink: link.toWikilink,
            position: link.position,
          })),
        });
      }

      const typedLinkDiagnostics =
        args.typed_link_constraint_mode === "off"
          ? []
          : collectTypedLinkDiagnostics(scannedNotes, args.typed_link_constraint_mode);

      const diagnosticsByPath = new Map<string, TypedLinkDiagnostic[]>();
      for (const diag of typedLinkDiagnostics) {
        const existing = diagnosticsByPath.get(diag.path) ?? [];
        existing.push(diag);
        diagnosticsByPath.set(diag.path, existing);
      }

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
        typed_link_diagnostics: TypedLinkDiagnostic[];
      }> = [];

      let okCount = 0;
      for (const note of scannedNotes) {
        const noteDiagnostics = diagnosticsByPath.get(note.path) ?? [];
        const hasConstraintError =
          args.typed_link_constraint_mode === "error" && noteDiagnostics.length > 0;

        const baseIsOk =
          note.has_frontmatter &&
          note.parsed_frontmatter &&
          note.missing_keys.length === 0 &&
          note.id_format_ok &&
          note.created_format_ok &&
          note.id_matches_created;
        const isOk = baseIsOk && !hasConstraintError;

        if (isOk) {
          okCount += 1;
          continue;
        }

        issues.push({
          path: note.path,
          has_frontmatter: note.has_frontmatter,
          parsed_frontmatter: note.parsed_frontmatter,
          missing_keys: note.missing_keys,
          id_value: note.id_value,
          created_value: note.created_value,
          id_format_ok: note.id_format_ok,
          created_format_ok: note.created_format_ok,
          id_matches_created: note.id_matches_created,
          typed_link_diagnostics: noteDiagnostics,
        });
      }

      const payload = {
        path_prefix: prefix,
        files_scanned: filesScanned,
        ok_count: okCount,
        issue_count: issues.length,
        truncated,
        typed_link_constraint_mode: args.typed_link_constraint_mode,
        typed_link_diagnostic_count: typedLinkDiagnostics.length,
        typed_link_diagnostics: typedLinkDiagnostics,
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
