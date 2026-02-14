import { semanticSearch } from "@ailss/core";

import type { McpToolDeps } from "../../mcpDeps.js";

import type { SemanticFilters } from "./filters.js";

export type SemanticSearchHit = ReturnType<typeof semanticSearch>[number];

export type OrderedHitRow = {
  path: string;
  hits: SemanticSearchHit[];
  best: SemanticSearchHit;
};

export type RetrievalPlan = {
  desiredNotes: number;
  hitChunksPerNote: number;
  usedChunksK: number;
  ordered: OrderedHitRow[];
};

export function planRetrieval(params: {
  db: McpToolDeps["db"];
  queryEmbedding: number[];
  semanticFilters: SemanticFilters;
  topK: number;
  hitChunksPerNote: number;
}): RetrievalPlan {
  const desiredNotes = Math.max(1, Math.min(params.topK, 50));
  const hitChunksPerNote = Math.max(1, Math.min(params.hitChunksPerNote, 5));
  const { chunkHits, usedChunksK } = overfetchChunkHits({
    db: params.db,
    queryEmbedding: params.queryEmbedding,
    desiredNotes,
    semanticFilters: params.semanticFilters,
  });
  const ordered = buildOrderedRows(chunkHits, desiredNotes, hitChunksPerNote);

  return {
    desiredNotes,
    hitChunksPerNote,
    usedChunksK,
    ordered,
  };
}

export function overfetchChunkHits(params: {
  db: McpToolDeps["db"];
  queryEmbedding: number[];
  desiredNotes: number;
  semanticFilters: SemanticFilters;
}): { chunkHits: SemanticSearchHit[]; usedChunksK: number } {
  // Over-fetch chunks so we can return enough unique note paths.
  // - Default cap is conservative (vaults can have many short sections).
  const maxChunksK = 500;
  let usedChunksK = Math.min(maxChunksK, Math.max(50, params.desiredNotes * 15));
  let chunkHits = semanticSearch(
    params.db,
    params.queryEmbedding,
    usedChunksK,
    params.semanticFilters,
  );

  for (let i = 0; i < 3; i += 1) {
    const uniquePaths = new Set(chunkHits.map((h) => h.path)).size;
    if (uniquePaths >= params.desiredNotes) break;
    if (usedChunksK >= maxChunksK) break;
    usedChunksK = Math.min(maxChunksK, usedChunksK * 2);
    chunkHits = semanticSearch(
      params.db,
      params.queryEmbedding,
      usedChunksK,
      params.semanticFilters,
    );
  }

  return { chunkHits, usedChunksK };
}

export function buildOrderedRows(
  chunkHits: SemanticSearchHit[],
  desiredNotes: number,
  hitChunksPerNote: number,
): OrderedHitRow[] {
  // Keep per-note top hits (distance-ordered globally, so first N per path are best).
  const hitsByPath = new Map<string, SemanticSearchHit[]>();
  for (const hit of chunkHits) {
    const existing = hitsByPath.get(hit.path);
    if (!existing) {
      hitsByPath.set(hit.path, [hit]);
      continue;
    }
    if (existing.length >= hitChunksPerNote) continue;
    existing.push(hit);
  }

  return Array.from(hitsByPath.entries())
    .map(([path, hits]) => ({ path, hits, best: hits[0] }))
    .filter((row): row is OrderedHitRow => Boolean(row.best))
    .sort((a, b) => a.best.distance - b.best.distance)
    .slice(0, desiredNotes);
}
