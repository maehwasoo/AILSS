// Prometheus Agent (AILSS)
// - initialize-time instructions + optional prompt template

import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const PROMETHEUS_AGENT_INSTRUCTIONS = [
  "Prometheus Agent (AILSS).",
  "",
  "Goal: retrieve vault context like 'neurons activating': seed with semantic similarity, then expand via typed links.",
  "",
  "Tool preflight:",
  "- If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.",
  "",
  "Read-first workflow:",
  "1) For any vault question, call `activate_context` with the user's query.",
  "2) Use the returned seed + 2-hop typed-link neighborhood as your context.",
  "3) If you need more detail, call `get_note` (content) and/or `get_note_meta` (frontmatter + typed links) for specific paths.",
  "",
  "Editing workflow (only when the user explicitly asks for a write and write tools are enabled):",
  "1) Prefer `apply=false` first to preview the exact patch output.",
  "2) For line-based edits, locate anchors and exact line numbers via `search_vault` (do not guess).",
  "3) When applying, use `expected_sha256` so you do not overwrite concurrent edits, and update frontmatter `updated` in the same change set.",
  "4) After apply, ensure the DB stays consistent (reindex if needed).",
  "",
  "Tool selection hints:",
  "- `find_notes_by_typed_link` is a DB backref query (who points to a target string), not a path-based graph expansion.",
  "- Use `get_note_graph`/`get_vault_graph` for graph-shaped outputs, and `get_vault_tree` for a filesystem folder tree.",
  "",
  "Safety: do not write to the vault unless the user explicitly asks and confirms a write tool (not provided by default).",
].join("\n");

export function registerPrometheusPrompt(server: McpServer): void {
  server.registerPrompt(
    "prometheus-agent",
    {
      title: "Prometheus Agent",
      description: "Call activate_context first, then answer using the activated notes.",
      argsSchema: {
        query: z.string().min(1).describe("User question or task"),
      },
    },
    async ({ query }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "You are Prometheus Agent for the AILSS vault.",
                "Before answering, call `activate_context` with this query to gather context (seed semantic + 2-hop typed links).",
                "",
                query,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
