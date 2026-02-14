import { resolveNotePathsByWikilinkTarget } from "@ailss/core";
import type { AilssDb, ResolvedNoteTarget } from "@ailss/core";

export const RESOLVE_LIMIT = 20;

export function resolveStrictPathTarget(
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

export function resolveTargetCandidates(db: AilssDb, target: string): ResolvedNoteTarget[] {
  if (target.includes("/")) {
    return resolveStrictPathTarget(db, target, RESOLVE_LIMIT);
  }
  return resolveNotePathsByWikilinkTarget(db, target, RESOLVE_LIMIT);
}

export function createResolveTargetCandidatesCache(
  db: AilssDb,
): (target: string) => ResolvedNoteTarget[] {
  const resolveCache = new Map<string, ResolvedNoteTarget[]>();
  return (target: string): ResolvedNoteTarget[] => {
    const key = target.trim();
    if (!key) return [];
    if (resolveCache.has(key)) return resolveCache.get(key) ?? [];
    const resolved = resolveTargetCandidates(db, key);
    resolveCache.set(key, resolved);
    return resolved;
  };
}
