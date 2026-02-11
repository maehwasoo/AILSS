import path from "node:path";

import type { AilssDb } from "../db.js";
import { nowIso } from "../migrate.js";

import type { NoteMeta } from "./notes.js";

export type TypedLinkInput = {
  rel: string;
  toTarget: string;
  toWikilink: string;
  position: number;
};

export function replaceTypedLinks(db: AilssDb, fromPath: string, links: TypedLinkInput[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM typed_links WHERE from_path = ?`).run(fromPath);
    const insert = db.prepare(`
      INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at)
      VALUES (@from_path, @rel, @to_target, @to_wikilink, @position, @created_at)
    `);

    for (const link of links) {
      insert.run({
        from_path: fromPath,
        rel: link.rel,
        to_target: link.toTarget,
        to_wikilink: link.toWikilink,
        position: link.position,
        created_at: nowIso(),
      });
    }
  });

  tx();
}

export type TypedLinkQuery = {
  rel?: string;
  rels?: string[];
  toTarget?: string;
  limit?: number;
};

export type TypedLinkBackref = {
  fromPath: string;
  fromTitle: string | null;
  rel: string;
  toTarget: string;
  toWikilink: string;
};

export function findNotesByTypedLink(db: AilssDb, query: TypedLinkQuery): TypedLinkBackref[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.rel) {
    where.push(`tl.rel = ?`);
    params.push(query.rel);
  }

  if (query.toTarget) {
    where.push(`tl.to_target = ?`);
    params.push(query.toTarget);
  }

  if (query.rels && query.rels.length > 0) {
    const rels = query.rels.map((r) => r.trim()).filter(Boolean);
    if (rels.length > 0) {
      where.push(`tl.rel IN (${rels.map(() => "?").join(", ")})`);
      params.push(...rels);
    }
  }

  const limit = Math.min(Math.max(1, query.limit ?? 100), 1000);

  const sql = `
    SELECT
      tl.from_path AS fromPath,
      n.title AS fromTitle,
      tl.rel AS rel,
      tl.to_target AS toTarget,
      tl.to_wikilink AS toWikilink
    FROM typed_links tl
    JOIN notes n ON n.path = tl.from_path
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY tl.rel, tl.to_target, tl.from_path, tl.position
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit) as TypedLinkBackref[];
}

export type TypedLinkRelFacet = {
  rel: string;
  count: number;
};

export type TypedLinkRelFacetQuery = {
  pathPrefix?: string;
  limit?: number;
  orderBy?: "count_desc" | "rel_asc";
};

export function listTypedLinkRels(
  db: AilssDb,
  query: TypedLinkRelFacetQuery = {},
): TypedLinkRelFacet[] {
  const where: string[] = [];
  const params: unknown[] = [];

  const pathPrefix = query.pathPrefix?.trim();
  if (pathPrefix) {
    where.push(`from_path LIKE ?`);
    params.push(`${pathPrefix}%`);
  }

  const limit = Math.min(Math.max(1, query.limit ?? 200), 5000);
  const orderByClause =
    query.orderBy === "rel_asc" ? "ORDER BY rel ASC, count DESC" : "ORDER BY count DESC, rel ASC";

  const sql = `
    SELECT rel, COUNT(*) AS count
    FROM typed_links
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY rel
    ${orderByClause}
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, limit) as TypedLinkRelFacet[];
}

export type ResolvedNoteTarget = {
  path: string;
  title: string | null;
  matchedBy: "path" | "note_id" | "title";
};

export function resolveNotePathsByWikilinkTarget(
  db: AilssDb,
  target: string,
  limit = 20,
): ResolvedNoteTarget[] {
  const trimmed = target.trim();
  if (!trimmed) return [];

  const effectiveLimit = Math.min(Math.max(1, limit), 200);

  // Wikilink target normalization
  // - support users who include `.md` in wikilinks
  const targetNoExt = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
  const targetWithExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;

  // Path-based match (vault-relative paths)
  const pathMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE path = ? OR path LIKE ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetWithExt, `%/${targetWithExt}`, effectiveLimit) as Array<{
    path: string;
    title: string | null;
  }>;

  // Note ID match (frontmatter-derived, if present)
  const noteIdMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE note_id = ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetNoExt, effectiveLimit) as Array<{ path: string; title: string | null }>;

  // Title-based match (frontmatter-derived, if present)
  const titleMatches = db
    .prepare(
      `
        SELECT path, title
        FROM notes
        WHERE title = ?
        ORDER BY path
        LIMIT ?
      `,
    )
    .all(targetNoExt, effectiveLimit) as Array<{ path: string; title: string | null }>;

  // Stable dedupe
  const out: ResolvedNoteTarget[] = [];
  const seen = new Set<string>();

  for (const row of pathMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "path" });
    if (out.length >= effectiveLimit) return out;
  }

  for (const row of noteIdMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "note_id" });
    if (out.length >= effectiveLimit) return out;
  }

  for (const row of titleMatches) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    out.push({ path: row.path, title: row.title, matchedBy: "title" });
    if (out.length >= effectiveLimit) return out;
  }

  return out;
}

export function guessWikilinkTargetsForNote(
  meta: Pick<NoteMeta, "path" | "title" | "noteId" | "frontmatter">,
): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined): void => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    targets.push(trimmed);
  };

  // Filename stem (default wikilink target in Obsidian)
  const base = path.basename(meta.path);
  const stem = base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
  add(stem);

  // Structured fields
  add(meta.title);
  add(meta.noteId);

  // Aliases (if present)
  const aliasesRaw = meta.frontmatter.aliases;
  if (typeof aliasesRaw === "string") {
    add(aliasesRaw);
  } else if (Array.isArray(aliasesRaw)) {
    for (const v of aliasesRaw) {
      if (typeof v === "string") add(v);
    }
  }

  return targets;
}
