import { getNoteMeta, listChunksByPathAndIndices } from "@ailss/core";

import type { McpToolDeps } from "../../mcpDeps.js";

import { readVaultFileText } from "../vaultFs.js";

import type { OrderedHitRow } from "./retrievalPlan.js";

export type EvidenceChunk = {
  chunk_id: string;
  chunk_index: number;
  kind: "hit" | "neighbor";
  distance: number | null;
  heading: string | null;
  heading_path: string[];
};

export type StitchResult = {
  text: string;
  truncated: boolean;
  used_chunk_ids: string[];
};

export type CompositionParams = {
  expandTopK: number;
  neighborWindow: number;
  perNoteEvidenceChars: number;
  includePreview: boolean;
  maxCharsPerNote: number;
  maxTotalEvidenceChars: number;
};

export type EvidenceComposition = {
  text: string | null;
  truncated: boolean;
  chunks: EvidenceChunk[];
  usedChars: number;
};

export type PreviewComposition = {
  preview: string | null;
  previewTruncated: boolean;
};

export type ToolResultRow = {
  path: string;
  distance: number;
  title: string | null;
  summary: string | null;
  tags: string[];
  keywords: string[];
  heading: string | null;
  heading_path: string[];
  snippet: string;
  evidence_text: string | null;
  evidence_truncated: boolean;
  evidence_chunks: EvidenceChunk[];
  preview: string | null;
  preview_truncated: boolean;
};

export async function composeResultRows(params: {
  db: McpToolDeps["db"];
  ordered: OrderedHitRow[];
  vaultPath: string | undefined;
  composition: CompositionParams;
}): Promise<ToolResultRow[]> {
  const results: ToolResultRow[] = [];
  let usedTotalEvidenceChars = 0;

  for (const [rank, row] of params.ordered.entries()) {
    const meta = getNoteMeta(params.db, row.path);
    let evidence: EvidenceComposition = { text: null, truncated: false, chunks: [], usedChars: 0 };

    if (
      rank < params.composition.expandTopK &&
      usedTotalEvidenceChars < params.composition.maxTotalEvidenceChars
    ) {
      const remainingGlobal = params.composition.maxTotalEvidenceChars - usedTotalEvidenceChars;
      const maxChars = Math.max(
        200,
        Math.min(params.composition.perNoteEvidenceChars, remainingGlobal),
      );
      evidence = composeEvidenceForRow({
        db: params.db,
        row,
        neighborWindow: params.composition.neighborWindow,
        maxChars,
      });
      usedTotalEvidenceChars += evidence.usedChars;
    }

    const preview = await composePreviewForRow({
      includePreview: params.composition.includePreview,
      vaultPath: params.vaultPath,
      path: row.path,
      maxCharsPerNote: params.composition.maxCharsPerNote,
    });

    results.push(
      buildResultRow({
        row,
        meta,
        evidence,
        preview,
      }),
    );
  }

  return results;
}

export function composeEvidenceForRow(params: {
  db: McpToolDeps["db"];
  row: OrderedHitRow;
  neighborWindow: number;
  maxChars: number;
}): EvidenceComposition {
  const wantedIndices = new Set<number>();
  for (let d = -params.neighborWindow; d <= params.neighborWindow; d += 1) {
    wantedIndices.add(params.row.best.chunkIndex + d);
  }
  for (const extra of params.row.hits.slice(1)) {
    wantedIndices.add(extra.chunkIndex);
  }

  const chunks = listChunksByPathAndIndices(params.db, params.row.path, Array.from(wantedIndices));

  const hitChunkIds = new Set(params.row.hits.map((h) => h.chunkId));
  const distanceByChunkId = new Map<string, number>();
  for (const h of params.row.hits) {
    distanceByChunkId.set(h.chunkId, h.distance);
  }

  const stitched = stitchChunkContents(chunks, params.maxChars);
  const usedChunkIds = new Set(stitched.used_chunk_ids);
  const evidenceChunks: EvidenceChunk[] = chunks
    .filter((c) => usedChunkIds.has(c.chunkId))
    .map((c) => ({
      chunk_id: c.chunkId,
      chunk_index: c.chunkIndex,
      kind: hitChunkIds.has(c.chunkId) ? "hit" : "neighbor",
      distance: distanceByChunkId.get(c.chunkId) ?? null,
      heading: c.heading,
      heading_path: c.headingPath,
    }));

  return {
    text: stitched.text,
    truncated: stitched.truncated,
    chunks: evidenceChunks,
    usedChars: stitched.text.length,
  };
}

export async function composePreviewForRow(params: {
  includePreview: boolean;
  vaultPath: string | undefined;
  path: string;
  maxCharsPerNote: number;
}): Promise<PreviewComposition> {
  if (!params.includePreview || !params.vaultPath) {
    return { preview: null, previewTruncated: false };
  }

  const { text, truncated } = await readVaultFileText({
    vaultPath: params.vaultPath,
    vaultRelPath: params.path,
    maxChars: params.maxCharsPerNote,
  });
  return { preview: text, previewTruncated: truncated };
}

function buildResultRow(params: {
  row: OrderedHitRow;
  meta: ReturnType<typeof getNoteMeta>;
  evidence: EvidenceComposition;
  preview: PreviewComposition;
}): ToolResultRow {
  const snippetSource = params.evidence.text ?? params.row.best.content;
  return {
    path: params.row.path,
    distance: params.row.best.distance,
    title: params.meta?.title ?? null,
    summary: params.meta?.summary ?? null,
    tags: params.meta?.tags ?? [],
    keywords: params.meta?.keywords ?? [],
    heading: params.row.best.heading,
    heading_path: params.row.best.headingPath,
    snippet: snippetSource.slice(0, 300),
    evidence_text: params.evidence.text,
    evidence_truncated: params.evidence.truncated,
    evidence_chunks: params.evidence.chunks,
    preview: params.preview.preview,
    preview_truncated: params.preview.previewTruncated,
  };
}

export function stitchChunkContents(
  chunks: Array<{ chunkId: string; content: string }>,
  maxChars: number,
): StitchResult {
  const budget = Math.max(1, Math.floor(maxChars));
  let text = "";
  let truncated = false;
  const usedChunkIds: string[] = [];

  for (const chunk of chunks) {
    const part = (chunk.content ?? "").trim();
    if (!part) continue;

    const separator = text ? "\n\n" : "";
    const next = `${text}${separator}${part}`;

    if (next.length <= budget) {
      text = next;
      usedChunkIds.push(chunk.chunkId);
      continue;
    }

    // Partial include
    const remaining = budget - text.length - separator.length;
    if (remaining > 0) {
      text = `${text}${separator}${part.slice(0, remaining)}`;
      usedChunkIds.push(chunk.chunkId);
    }
    truncated = true;
    break;
  }

  return { text, truncated, used_chunk_ids: usedChunkIds };
}
