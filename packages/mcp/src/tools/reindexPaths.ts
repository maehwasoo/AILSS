// reindex_paths tool
// - refresh the index DB for specific vault paths (embeddings + metadata)
// - DB write + OpenAI usage costs (explicit apply)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { reindexVaultPaths } from "../lib/reindexVaultPaths.js";

export function registerReindexPathsTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "reindex_paths",
    {
      title: "Reindex paths",
      description:
        "Reindexes specific vault-relative Markdown paths into the AILSS SQLite DB (embeddings + metadata). Requires AILSS_VAULT_PATH. Writes only when apply=true.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe("Vault-relative markdown paths to index (e.g. ['Projects/Plan.md'])"),
        apply: z.boolean().default(false).describe("Apply DB writes; false = dry-run"),
      },
      outputSchema: z.object({
        applied: z.boolean(),
        paths: z.array(z.string()),
        embedding_model: z.string(),
        summary: z
          .object({
            changed_files: z.number().int().nonnegative(),
            indexed_chunks: z.number().int().nonnegative(),
            deleted_files: z.number().int().nonnegative(),
          })
          .nullable(),
      }),
    },
    async (args) => {
      if (!deps.vaultPath) {
        throw new Error("Cannot reindex because AILSS_VAULT_PATH is not set.");
      }

      const paths = args.paths.map((p) => p.trim()).filter(Boolean);
      if (!args.apply) {
        const payload = {
          applied: false,
          paths,
          embedding_model: deps.embeddingModel,
          summary: null,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }

      const summary = await reindexVaultPaths(deps, paths);
      const payload = {
        applied: true,
        paths,
        embedding_model: deps.embeddingModel,
        summary: {
          changed_files: summary.changedFiles,
          indexed_chunks: summary.indexedChunks,
          deleted_files: summary.deletedFiles,
        },
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
