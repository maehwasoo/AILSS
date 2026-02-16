import type { AilssDb } from "../../db.js";

import { safeParseJsonObject } from "../shared.js";

import type { NoteMeta, NoteRow } from "./types.js";

export function getNoteMeta(db: AilssDb, notePath: string): NoteMeta | null {
  const note = db.prepare(`SELECT * FROM notes WHERE path = ?`).get(notePath) as
    | NoteRow
    | undefined;
  if (!note) return null;

  const tags = db
    .prepare(`SELECT tag FROM note_tags WHERE path = ? ORDER BY tag`)
    .all(notePath) as Array<{ tag: string }>;

  const keywords = db
    .prepare(`SELECT keyword FROM note_keywords WHERE path = ? ORDER BY keyword`)
    .all(notePath) as Array<{ keyword: string }>;

  const sources = db
    .prepare(`SELECT source FROM note_sources WHERE path = ? ORDER BY source`)
    .all(notePath) as Array<{ source: string }>;

  const typedLinks = db
    .prepare(
      `SELECT rel, to_target, to_wikilink, position FROM typed_links WHERE from_path = ? ORDER BY rel, position`,
    )
    .all(notePath) as Array<{
    rel: string;
    to_target: string;
    to_wikilink: string;
    position: number;
  }>;

  return {
    path: note.path,
    noteId: note.note_id,
    created: note.created,
    title: note.title,
    summary: note.summary,
    entity: note.entity,
    layer: note.layer,
    status: note.status,
    updated: note.updated,
    tags: tags.map((t) => t.tag),
    keywords: keywords.map((k) => k.keyword),
    sources: sources.map((s) => s.source),
    frontmatter: safeParseJsonObject(note.frontmatter_json),
    typedLinks: typedLinks.map((l) => ({
      rel: l.rel,
      toTarget: l.to_target,
      toWikilink: l.to_wikilink,
      position: l.position,
    })),
  };
}
