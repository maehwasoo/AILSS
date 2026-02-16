import {
  listMarkdownFiles,
  normalizeAilssNoteMeta,
  parseMarkdownNote,
  validateAilssFrontmatterEnums,
} from "@ailss/core";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  coerceTrimmedStringOrEmpty,
  hasFrontmatterBlock,
  idFromCreated,
} from "../frontmatterIdentity.js";

import type { ScannedNote, TargetLookupNote } from "./types.js";

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function normalizeEntity(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

export async function scanVaultNotesForFrontmatterValidate(options: {
  vaultPath: string;
  pathPrefix: string | null;
  maxFiles: number;
  requiredKeys: readonly string[];
}): Promise<{
  scannedNotes: ScannedNote[];
  targetLookupNotes: TargetLookupNote[];
  filesScanned: number;
  truncated: boolean;
}> {
  const prefix = options.pathPrefix ? options.pathPrefix.trim() : null;
  const absFiles = await listMarkdownFiles(options.vaultPath);
  const relFiles = absFiles.map((abs) => relPathFromAbs(options.vaultPath, abs));
  const filtered = prefix ? relFiles.filter((p) => p.startsWith(prefix)) : relFiles;

  const scannedNotes: ScannedNote[] = [];

  let filesScanned = 0;
  let truncated = false;

  for (const relPath of filtered) {
    if (filesScanned >= options.maxFiles) {
      truncated = true;
      break;
    }

    const absPath = path.join(options.vaultPath, relPath);
    filesScanned += 1;

    const markdown = await fs.readFile(absPath, "utf8");
    const hasFm = hasFrontmatterBlock(markdown);
    const parsed = parseMarkdownNote(markdown);
    const fm = parsed.frontmatter ?? {};
    const normalizedMeta = normalizeAilssNoteMeta(fm);

    const missing: string[] = [];
    for (const key of options.requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(fm, key)) missing.push(key);
    }

    const enumViolations = validateAilssFrontmatterEnums(fm).map((violation) => ({
      key: violation.key,
      value: violation.value,
    }));

    const idRaw = coerceTrimmedStringOrEmpty((fm as Record<string, unknown>).id);
    const createdRaw = coerceTrimmedStringOrEmpty((fm as Record<string, unknown>).created);
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
      enum_violations: enumViolations,
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

  let targetLookupNotes: TargetLookupNote[] = scannedNotes.map((note) => ({
    path: note.path,
    parsed_frontmatter: note.parsed_frontmatter,
    note_id: note.note_id,
    title: note.title,
    entity: note.entity,
  }));

  // Prefix scan policy
  // - source-note set is limited by path_prefix/max_files
  // - target resolution uses vault-wide metadata for better relation validation accuracy
  if (prefix) {
    const scannedPathSet = new Set(scannedNotes.map((note) => note.path));
    const additionalLookupNotes: TargetLookupNote[] = [];

    for (const relPath of relFiles) {
      if (scannedPathSet.has(relPath)) continue;
      const absPath = path.join(options.vaultPath, relPath);
      const markdown = await fs.readFile(absPath, "utf8");
      const hasFm = hasFrontmatterBlock(markdown);
      const parsed = parseMarkdownNote(markdown);
      const fm = parsed.frontmatter ?? {};
      const normalizedMeta = normalizeAilssNoteMeta(fm);

      additionalLookupNotes.push({
        path: relPath,
        parsed_frontmatter: hasFm && Object.keys(fm).length > 0,
        note_id: normalizedMeta.noteId,
        title: normalizedMeta.title,
        entity: normalizeEntity(normalizedMeta.entity),
      });
    }

    targetLookupNotes = [...targetLookupNotes, ...additionalLookupNotes];
  }

  return { scannedNotes, targetLookupNotes, filesScanned, truncated };
}
