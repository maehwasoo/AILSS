// read_note tool
// - vault filesystem read

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { readVaultFileFullText } from "../lib/vaultFs.js";

export function registerGetNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description:
        "Reads a Markdown note from the vault filesystem by vault-relative path. Requires AILSS_VAULT_PATH; path traversal is blocked. Supports pagination via `start_index` + `max_chars` and returns `next_start_index` when truncated.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown note path (e.g. "Projects/Plan.md")'),
        start_index: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Start offset into the note text (0-based) for pagination"),
        max_chars: z
          .number()
          .int()
          .min(200)
          .max(200_000)
          .default(20_000)
          .describe("Maximum characters to return (200–200,000)"),
      },
      outputSchema: z.object({
        path: z.string(),
        start_index: z.number().int(),
        max_chars: z.number().int(),
        truncated: z.boolean(),
        next_start_index: z.number().int().nullable(),
        content: z.string(),
      }),
    },
    async (args) => {
      if (!deps.vaultPath) {
        throw new Error("Cannot read files because AILSS_VAULT_PATH is not set.");
      }

      const fullText = await readVaultFileFullText({
        vaultPath: deps.vaultPath,
        vaultRelPath: args.path,
      });

      const startIndex = args.start_index;
      if (startIndex >= fullText.length) {
        return {
          structuredContent: {
            path: args.path,
            start_index: startIndex,
            max_chars: args.max_chars,
            truncated: false,
            next_start_index: null,
            content: "",
          },
          // Preserve legacy behavior: content is the note text (not JSON)
          content: [{ type: "text", text: "" }],
        };
      }

      const text = fullText.slice(startIndex, startIndex + args.max_chars);
      const nextStartIndex = startIndex + text.length;
      const truncated = nextStartIndex < fullText.length;

      return {
        structuredContent: {
          path: args.path,
          start_index: startIndex,
          max_chars: args.max_chars,
          truncated,
          next_start_index: truncated ? nextStartIndex : null,
          content: text,
        },
        // Preserve legacy behavior: content is the note text (not JSON)
        content: [{ type: "text", text }],
      };
    },
  );
}
