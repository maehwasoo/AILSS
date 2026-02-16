import { z } from "zod";

export function buildGetContextInputSchema(defaultTopK: number) {
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

export function buildGetContextOutputSchema() {
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
