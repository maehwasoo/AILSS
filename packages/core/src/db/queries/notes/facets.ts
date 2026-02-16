import type { AilssDb } from "../../db.js";

import type { KeywordFacet, TagFacet } from "./types.js";

export function listTags(db: AilssDb, options: { limit?: number } = {}): TagFacet[] {
  const limit = Math.min(Math.max(1, options.limit ?? 200), 5000);
  const rows = db
    .prepare(
      `
        SELECT tag, COUNT(*) as count
        FROM note_tags
        GROUP BY tag
        ORDER BY count DESC, tag ASC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{ tag: string; count: number }>;
  return rows;
}

export function listKeywords(db: AilssDb, options: { limit?: number } = {}): KeywordFacet[] {
  const limit = Math.min(Math.max(1, options.limit ?? 200), 5000);
  const rows = db
    .prepare(
      `
        SELECT keyword, COUNT(*) as count
        FROM note_keywords
        GROUP BY keyword
        ORDER BY count DESC, keyword ASC
        LIMIT ?
      `,
    )
    .all(limit) as Array<{ keyword: string; count: number }>;
  return rows;
}
