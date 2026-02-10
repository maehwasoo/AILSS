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

      const results: Array<{
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
      }> = [];

      const expandTopK = Math.max(0, Math.min(args.expand_top_k, desiredNotes));
      const neighborWindow = Math.max(0, Math.min(args.neighbor_window, 3));
      const perNoteEvidenceChars = Math.max(
        200,
        Math.min(args.max_evidence_chars_per_note, 20_000),
      );
      const includePreview = Boolean(args.include_file_preview && deps.vaultPath);

      const maxTotalEvidenceChars = expandTopK * perNoteEvidenceChars;
      let usedTotalEvidenceChars = 0;

      for (const [rank, row] of ordered.entries()) {
        const best = row.best;
        if (!best) continue;

        const meta = getNoteMeta(deps.db, row.path);
        const title = meta?.title ?? null;
        const summary = meta?.summary ?? null;
        const tags = meta?.tags ?? [];
        const keywords = meta?.keywords ?? [];

        let evidenceText: string | null = null;
        let evidenceTruncated = false;
        let evidenceChunks: EvidenceChunk[] = [];

        if (rank < expandTopK && usedTotalEvidenceChars < maxTotalEvidenceChars) {
          const remainingGlobal = maxTotalEvidenceChars - usedTotalEvidenceChars;
          const maxChars = Math.max(200, Math.min(perNoteEvidenceChars, remainingGlobal));

          const wantedIndices = new Set<number>();
          for (let d = -neighborWindow; d <= neighborWindow; d += 1) {
            wantedIndices.add(best.chunkIndex + d);
          }

          for (const extra of row.hits.slice(1)) {
            wantedIndices.add(extra.chunkIndex);
          }

          const chunks = listChunksByPathAndIndices(deps.db, row.path, Array.from(wantedIndices));

          const hitChunkIds = new Set(row.hits.map((h) => h.chunkId));
          const distanceByChunkId = new Map<string, number>();
          for (const h of row.hits) {
            distanceByChunkId.set(h.chunkId, h.distance);
          }

          const stitched = stitchChunkContents(chunks, maxChars);
          evidenceText = stitched.text;
          evidenceTruncated = stitched.truncated;
          usedTotalEvidenceChars += stitched.text.length;

          const usedChunkIds = new Set(stitched.used_chunk_ids);
          evidenceChunks = chunks
            .filter((c) => usedChunkIds.has(c.chunkId))
            .map((c) => ({
              chunk_id: c.chunkId,
              chunk_index: c.chunkIndex,
              kind: hitChunkIds.has(c.chunkId) ? "hit" : "neighbor",
              distance: distanceByChunkId.get(c.chunkId) ?? null,
              heading: c.heading,
              heading_path: c.headingPath,
            }));
        }

        const snippetSource = evidenceText ?? best.content;
        const snippet = snippetSource.slice(0, 300);

        let preview: string | null = null;
        let previewTruncated = false;
        if (includePreview && deps.vaultPath) {
          const { text, truncated } = await readVaultFileText({
            vaultPath: deps.vaultPath,
            vaultRelPath: row.path,
            maxChars: args.max_chars_per_note,
          });
          preview = text;
          previewTruncated = truncated;
        }

        results.push({
          path: row.path,
          distance: best.distance,
          title,
          summary,
          tags,
          keywords,
          heading: best.heading,
          heading_path: best.headingPath,
          snippet,
          evidence_text: evidenceText,
          evidence_truncated: evidenceTruncated,
          evidence_chunks: evidenceChunks,
          preview,
          preview_truncated: previewTruncated,
        });
      }

      const payload = {
        query: args.query,
        top_k: args.top_k,
        db: deps.dbPath,
        used_chunks_k: usedChunksK,
        applied_filters: appliedFilters,
        params: {
          expand_top_k: expandTopK,
          hit_chunks_per_note: hitChunksPerNote,
          neighbor_window: neighborWindow,
          max_evidence_chars_per_note: perNoteEvidenceChars,
          include_file_preview: includePreview,
          max_chars_per_note: args.max_chars_per_note,
        },
        results,
      };

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
