// Prometheus Agent (AILSS)
// - initialize-time instructions + optional prompt template

import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const PROMETHEUS_AGENT_INSTRUCTIONS = [
  "Prometheus Agent (AILSS).",
  "",
  "Goal: retrieve vault context like 'neurons activating': start with semantic retrieval, then expand via typed links.",
  "",
  "Tool preflight:",
  "- If you are unsure what tools exist or what arguments they require, call `tools/list` and follow the returned schemas exactly.",
  "",
  "Read-first workflow:",
  "1) For any vault-dependent task, call `get_context` with the user's query.",
  "2) If you need link-shaped navigation from a specific note, call `get_typed_links` (incoming + outgoing, up to 2 hops).",
  "3) If you need exact wording/fields, call `read_note` for the specific path (do not assume).",
  "",
  "New-note workflow (only when the user explicitly asks for a write and write tools are enabled):",
  "1) Prefer creating new notes via `capture_note` so required frontmatter keys exist and `id` matches `created`.",
  "2) Use `apply=false` first (dry-run), then ask for confirmation before `apply=true`.",
  "3) Do not override `id`/`created` unless the user explicitly requests it.",
  "",
  "Editing workflow (only when the user explicitly asks for a write and write tools are enabled):",
  "1) Prefer `apply=false` first to preview the exact patch output.",
  "2) For line-based edits, fetch the full note via `read_note`, compute exact line numbers, then preview again (do not guess).",
  "3) When applying, use `expected_sha256` so you do not overwrite concurrent edits, and update frontmatter `updated` in the same change set.",
  "4) After apply, confirm the tool's reindex result (or rerun indexing from the Obsidian plugin) so the DB stays consistent.",
  "",
  "Tool selection hints:",
  "- Use `frontmatter_validate` to check vault-wide frontmatter health (required keys + id/created consistency).",
  "- Use `get_vault_tree` to understand folder/file structure without reading note bodies.",
  "",
  "Safety: do not write to the vault unless the user explicitly asks and confirms a write tool (not provided by default).",
].join("\n");

export function registerPrometheusPrompt(server: McpServer): void {
  server.registerPrompt(
    "prometheus-agent",
    {
      title: "Prometheus Agent",
      description: "Call get_context first, then answer using retrieved notes.",
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
                "Before answering, call `get_context` with this query to gather context from the vault index.",
                "",
                query,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "prometheus-capture-note",
    {
      title: "Prometheus Capture Note",
      description: "Create an AILSS-formatted note via capture_note (dry-run first).",
      argsSchema: {
        query: z.string().min(1).describe("What note to create (topic + intent)"),
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
                "Task: create a new note that follows the AILSS frontmatter template and a consistent body structure.",
                "",
                "Workflow:",
                "1) Call `get_context` with the query to check for existing notes and consistent terminology.",
                "2) Draft note content:",
                "   - Title: concise and specific.",
                "   - Frontmatter: let `capture_note` generate `id`/`created`/`updated`; only set safe fields like `summary`, `tags`, `keywords` (avoid overriding identity fields).",
                "   - Body: start with a short summary, then key points, then next actions/open questions, then relevant wikilinks.",
                "3) Call `capture_note` with `apply=false` first to preview the resulting path + sha256.",
                "4) Ask the user for confirmation before calling `capture_note` again with `apply=true`.",
                "",
                "If `capture_note` is not available, explain that write tools are disabled and ask the user to enable them.",
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
