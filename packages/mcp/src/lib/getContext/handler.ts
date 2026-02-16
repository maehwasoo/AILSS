import type { McpToolDeps } from "../../mcpDeps.js";

import { embedQuery } from "../openaiEmbeddings.js";

import { buildAppliedFilters, buildSemanticFilters } from "./filters.js";
import type { AppliedFilters } from "./filters.js";
import { composeResultRows } from "./composeEvidence.js";
import type { CompositionParams, ToolResultRow } from "./composeEvidence.js";
import { planRetrieval } from "./retrievalPlan.js";

export type GetContextCallArgs = {
  query: string;
  path_prefix: string | undefined;
  tags_any: string[];
  tags_all: string[];
  top_k: number;
  expand_top_k: number;
  hit_chunks_per_note: number;
  neighbor_window: number;
  max_evidence_chars_per_note: number;
  include_file_preview: boolean;
  max_chars_per_note: number;
};

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

export async function handleGetContextCall(deps: McpToolDeps, args: GetContextCallArgs) {
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
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}
