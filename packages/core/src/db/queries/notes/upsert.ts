import type { AilssDb } from "../../db.js";
import { nowIso } from "../../migrate.js";

import type { UpsertNoteInput } from "./types.js";

export function upsertNote(db: AilssDb, input: UpsertNoteInput): void {
  const stmt = db.prepare(`
    INSERT INTO notes(
      path, note_id, created, title, summary,
      entity, layer, status, updated,
      frontmatter_json, updated_at
    )
    VALUES (
      @path, @note_id, @created, @title, @summary,
      @entity, @layer, @status, @updated,
      @frontmatter_json, @updated_at
    )
    ON CONFLICT(path) DO UPDATE SET
      note_id=excluded.note_id,
      created=excluded.created,
      title=excluded.title,
      summary=excluded.summary,
      entity=excluded.entity,
      layer=excluded.layer,
      status=excluded.status,
      updated=excluded.updated,
      frontmatter_json=excluded.frontmatter_json,
      updated_at=excluded.updated_at
  `);

  stmt.run({
    path: input.path,
    note_id: input.noteId,
    created: input.created,
    title: input.title,
    summary: input.summary,
    entity: input.entity,
    layer: input.layer,
    status: input.status,
    updated: input.updated,
    frontmatter_json: input.frontmatterJson,
    updated_at: nowIso(),
  });
}

export function replaceNoteTags(db: AilssDb, notePath: string, tags: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_tags WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_tags(path, tag) VALUES (?, ?)`);
    for (const tag of tags) {
      insert.run(notePath, tag);
    }
  });
  tx();
}

export function replaceNoteKeywords(db: AilssDb, notePath: string, keywords: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_keywords WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_keywords(path, keyword) VALUES (?, ?)`);
    for (const keyword of keywords) {
      insert.run(notePath, keyword);
    }
  });
  tx();
}

export function replaceNoteSources(db: AilssDb, notePath: string, sources: string[]): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM note_sources WHERE path = ?`).run(notePath);
    const insert = db.prepare(`INSERT INTO note_sources(path, source) VALUES (?, ?)`);
    for (const source of sources) {
      insert.run(notePath, source);
    }
  });
  tx();
}
