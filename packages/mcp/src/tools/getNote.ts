// get_note tool
// - vault filesystem read

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { readVaultFileText } from "../lib/vaultFs.js";

export function registerGetNoteTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description:
        "Reads a Markdown note from the vault filesystem by vault-relative path. Requires AILSS_VAULT_PATH; path traversal is blocked. Returns raw note text (may be truncated by `max_chars`).",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative Markdown note path (e.g. "Projects/Plan.md")'),
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
        max_chars: z.number().int(),
        truncated: z.boolean(),
        content: z.string(),
      }),
    },
    async (args) => {
      if (!deps.vaultPath) {
        throw new Error("Cannot read files because AILSS_VAULT_PATH is not set.");
      }

      const { text, truncated } = await readVaultFileText({
        vaultPath: deps.vaultPath,
        vaultRelPath: args.path,
        maxChars: args.max_chars,
      });

      return {
        structuredContent: {
          path: args.path,
          max_chars: args.max_chars,
          truncated,
          content: text,
        },
        // Preserve legacy behavior: content is the note text (not JSON)
        content: [{ type: "text", text }],
      };
    },
  );
}
