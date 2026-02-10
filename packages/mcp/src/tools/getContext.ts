// get_context tool
// - semantic search + stitched evidence (multi-chunk + neighbors)

import { getNoteMeta, listChunksByPathAndIndices, semanticSearch } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { embedQuery } from "../lib/openaiEmbeddings.js";
import { readVaultFileText } from "../lib/vaultFs.js";

type EvidenceChunk = {
  chunk_id: string;
  chunk_index: number;
  kind: "hit" | "neighbor";
  distance: number | null;
  heading: string | null;
  heading_path: string[];
};

type StitchResult = {
  text: string;
  truncated: boolean;
  used_chunk_ids: string[];
};

type SemanticSearchHit = ReturnType<typeof semanticSearch>[number];

type AppliedFilters = {
  path_prefix: string | null;
  tags_any: string[];
  tags_all: string[];
};

type SemanticFilters = {
  tagsAny: string[];
  tagsAll: string[];
  pathPrefix?: string;
};

type OrderedHitRow = {
  path: string;
  hits: SemanticSearchHit[];
  best: SemanticSearchHit;
};

type RetrievalPlan = {
  desiredNotes: number;
  hitChunksPerNote: number;
  usedChunksK: number;
  ordered: OrderedHitRow[];
};

type ToolResultRow = {
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

type CompositionParams = {
  expandTopK: number;
  neighborWindow: number;
  perNoteEvidenceChars: number;
  includePreview: boolean;
  maxCharsPerNote: number;
  maxTotalEvidenceChars: number;
};

type EvidenceComposition = {
  text: string | null;
  truncated: boolean;
  chunks: EvidenceChunk[];
  usedChars: number;
};

type PreviewComposition = {
  preview: string | null;
  previewTruncated: boolean;
};

export function registerGetContextTool(server: McpServer, deps: McpToolDeps): void {
  const defaultTopK = parseDefaultTopKFromEnv(process.env.AILSS_GET_CONTEXT_DEFAULT_TOP_K);

  server.registerTool(
    "get_context",
    {
      title: "Get context",
      description:
        "Builds a context set for a query: semantic search over indexed chunks, then returns the top matching notes with note metadata and stitched evidence chunks (optionally with file-start previews).",
      inputSchema: buildGetContextInputSchema(defaultTopK),
      outputSchema: buildGetContextOutputSchema(),
    },
    async (args) => {
      const queryEmbedding = await embedQuery(deps.openai, deps.embeddingModel, args.query);
      const appliedFilters = buildAppliedFilters(args.path_prefix, args.tags_any, args.tags_all);
      const semanticFilters = buildSemanticFilters(appliedFilters);
      const { desiredNotes, hitChunksPerNote, usedChunksK, ordered } = planRetrieval({
        db: deps.db,
        queryEmbedding,
        semanticFilters,
        topK: args.top_k,
        hitChunksPerNote: args.hit_chunks_per_note,
      });
      const composition = buildCompositionParams({
        desiredNotes,
        expandTopK: args.expand_top_k,
        neighborWindow: args.neighbor_window,
        maxEvidenceCharsPerNote: args.max_evidence_chars_per_note,
        includeFilePreview: args.include_file_preview,
        hasVaultPath: Boolean(deps.vaultPath),
        maxCharsPerNote: args.max_chars_per_note,
      });
      const results = await composeResultRows({
        db: deps.db,
        ordered,
        vaultPath: deps.vaultPath,
        composition,
      });
      const payload = buildPayload({
        query: args.query,
        topK: args.top_k,
        dbPath: deps.dbPath,
        usedChunksK,
        appliedFilters,
        hitChunksPerNote,
        composition,
        results,
      });

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

function buildGetContextInputSchema(defaultTopK: number) {
  return {
    query: z.string().min(1).describe("User question/task to retrieve related notes for"),
    path_prefix: z.string().min(1).optional().describe("Optional vault-relative path prefix"),
    tags_any: z
      .array(z.string().min(1))
      .default([])
      .describe("Match notes that have ANY of these tags"),
    tags_all: z
      .array(z.string().min(1))
      .default([])
      .describe("Match notes that have ALL of these tags"),
    top_k: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(defaultTopK)
      .describe("Maximum number of note results to return (1–50)"),
    expand_top_k: z
      .number()
      .int()
      .min(0)
      .max(50)
      .default(5)
      .describe(
        "How many of the top_k notes should include stitched evidence text (0–50). The rest return metadata only.",
      ),
    hit_chunks_per_note: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2)
      .describe("How many best-matching chunks to keep per note (1–5)"),
    neighbor_window: z
      .number()
      .int()
      .min(0)
      .max(3)
      .default(1)
      .describe("How many neighbor chunks (±window) to stitch around the best hit (0–3)"),
    max_evidence_chars_per_note: z
      .number()
      .int()
      .min(200)
      .max(20_000)
      .default(1500)
      .describe("Evidence text budget per expanded note (characters)"),
    include_file_preview: z
      .boolean()
      .default(false)
      .describe(
        "When true, include a file-start preview (max_chars_per_note) in addition to evidence text (requires AILSS_VAULT_PATH).",
      ),
    max_chars_per_note: z
      .number()
      .int()
      .min(200)
      .max(50_000)
      .default(800)
      .describe("File-start preview size per note (characters), when include_file_preview=true"),
  };
}

function buildGetContextOutputSchema() {
  return z.object({
    query: z.string(),
    top_k: z.number().int(),
    db: z.string(),
    used_chunks_k: z.number().int(),
    applied_filters: z.object({
      path_prefix: z.string().nullable(),
      tags_any: z.array(z.string()),
      tags_all: z.array(z.string()),
    }),
    params: z.object({
      expand_top_k: z.number().int(),
      hit_chunks_per_note: z.number().int(),
      neighbor_window: z.number().int(),
      max_evidence_chars_per_note: z.number().int(),
      include_file_preview: z.boolean(),
      max_chars_per_note: z.number().int(),
    }),
    results: z.array(
      z.object({
        path: z.string(),
        distance: z.number(),
        title: z.string().nullable(),
        summary: z.string().nullable(),
        tags: z.array(z.string()),
        keywords: z.array(z.string()),
        heading: z.string().nullable(),
        heading_path: z.array(z.string()),
        snippet: z.string(),
        evidence_text: z.string().nullable(),
        evidence_truncated: z.boolean(),
        evidence_chunks: z.array(
          z.object({
            chunk_id: z.string(),
            chunk_index: z.number().int(),
            kind: z.enum(["hit", "neighbor"]),
            distance: z.number().nullable(),
            heading: z.string().nullable(),
            heading_path: z.array(z.string()),
          }),
        ),
        preview: z.string().nullable(),
        preview_truncated: z.boolean(),
      }),
    ),
  });
}

function buildAppliedFilters(
  pathPrefix: string | undefined,
  tagsAny: string[] | undefined,
  tagsAll: string[] | undefined,
): AppliedFilters {
  return {
    path_prefix: pathPrefix?.trim() || null,
    tags_any: normalizeFilterStrings(tagsAny),
    tags_all: normalizeFilterStrings(tagsAll),
  };
}

function buildSemanticFilters(appliedFilters: AppliedFilters): SemanticFilters {
  return {
    tagsAny: appliedFilters.tags_any,
    tagsAll: appliedFilters.tags_all,
    ...(appliedFilters.path_prefix ? { pathPrefix: appliedFilters.path_prefix } : {}),
  };
}

function planRetrieval(params: {
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

function overfetchChunkHits(params: {
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

function buildOrderedRows(
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

function buildCompositionParams(params: {
  desiredNotes: number;
  expandTopK: number;
  neighborWindow: number;
  maxEvidenceCharsPerNote: number;
  includeFilePreview: boolean;
  hasVaultPath: boolean;
  maxCharsPerNote: number;
}): CompositionParams {
  const expandTopK = Math.max(0, Math.min(params.expandTopK, params.desiredNotes));
  const neighborWindow = Math.max(0, Math.min(params.neighborWindow, 3));
  const perNoteEvidenceChars = Math.max(200, Math.min(params.maxEvidenceCharsPerNote, 20_000));
  const includePreview = Boolean(params.includeFilePreview && params.hasVaultPath);

  return {
    expandTopK,
    neighborWindow,
    perNoteEvidenceChars,
    includePreview,
    maxCharsPerNote: params.maxCharsPerNote,
    maxTotalEvidenceChars: expandTopK * perNoteEvidenceChars,
  };
}

async function composeResultRows(params: {
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

function composeEvidenceForRow(params: {
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

async function composePreviewForRow(params: {
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

function buildPayload(params: {
  query: string;
  topK: number;
  dbPath: string;
  usedChunksK: number;
  appliedFilters: AppliedFilters;
  hitChunksPerNote: number;
  composition: CompositionParams;
  results: ToolResultRow[];
}) {
  return {
    query: params.query,
    top_k: params.topK,
    db: params.dbPath,
    used_chunks_k: params.usedChunksK,
    applied_filters: params.appliedFilters,
    params: {
      expand_top_k: params.composition.expandTopK,
      hit_chunks_per_note: params.hitChunksPerNote,
      neighbor_window: params.composition.neighborWindow,
      max_evidence_chars_per_note: params.composition.perNoteEvidenceChars,
      include_file_preview: params.composition.includePreview,
      max_chars_per_note: params.composition.maxCharsPerNote,
    },
    results: params.results,
  };
}

function stitchChunkContents(
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

function parseDefaultTopKFromEnv(raw: string | undefined): number {
  const defaultTopK = 10;
  if (!raw) return defaultTopK;
  const trimmed = raw.trim();
  if (!trimmed) return defaultTopK;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return defaultTopK;

  const n = Math.floor(parsed);
  if (n < 1) return 1;
  if (n > 50) return 50;
  return n;
}

function normalizeFilterStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}
