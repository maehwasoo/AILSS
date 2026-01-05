// Prometheus Agent (AILSS)
// - initialize-time instructions + optional prompt template

import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const PROMETHEUS_AGENT_INSTRUCTIONS = [
  "Prometheus Agent (AILSS).",
  "",
  "Goal: retrieve vault context like 'neurons activating': seed with semantic similarity, then expand via typed links.",
  "",
  "Read-first workflow:",
  "1) For any vault question, call `activate_context` with the user's query.",
  "2) Use the returned seed + 2-hop typed-link neighborhood as your context.",
  "3) If you need more detail, call `get_note` (content) and/or `get_note_meta` (frontmatter + typed links) for specific paths.",
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
