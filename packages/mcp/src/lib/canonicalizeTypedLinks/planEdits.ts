import { AILSS_TYPED_LINK_KEYS } from "@ailss/core";
import type { AilssDb } from "@ailss/core";

import { createResolveTargetCandidatesCache } from "./resolver.js";
import { canonicalWikilink, removeMarkdownExtension, splitTargetAndDisplay } from "./target.js";

export type ReplacementEdit = {
  rel: string;
  index: number;
  before: string;
  after: string;
  target_before: string;
  target_after: string;
};

export type UnresolvedItem = {
  rel: string;
  index: number;
  before: string;
  target: string;
};

export type AmbiguousItem = {
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

const MAX_REPORTED_CANDIDATES = 5;

export function planCanonicalizeTypedLinkEdits(args: {
  db: AilssDb;
  frontmatter: Record<string, unknown>;
}): {
  nextFrontmatter: Record<string, unknown>;
  edits: ReplacementEdit[];
  unresolved: UnresolvedItem[];
  ambiguous: AmbiguousItem[];
} {
  const { db, frontmatter } = args;

  const nextFrontmatter: Record<string, unknown> = { ...frontmatter };

  const edits: ReplacementEdit[] = [];
  const unresolved: UnresolvedItem[] = [];
  const ambiguous: AmbiguousItem[] = [];

  const resolveCached = createResolveTargetCandidatesCache(db);

  for (const rel of AILSS_TYPED_LINK_KEYS) {
    const current = frontmatter[rel];

    if (typeof current === "string") {
      const { target_for_resolution, display_for_canonical_link } = splitTargetAndDisplay(current);
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

      const { target_for_resolution, display_for_canonical_link } = splitTargetAndDisplay(entry);
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

  return { nextFrontmatter, edits, unresolved, ambiguous };
}
