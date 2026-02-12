// get_tool_failure_report tool
// - MCP tool failure diagnostics summary

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerGetToolFailureReportTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_tool_failure_report",
    {
      title: "Get tool failure report",
      description:
        "Summarizes structured MCP tool failure logs from `<vault>/.ailss/logs` as recent events and top recurring error types.",
      inputSchema: {
        recent_limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("How many recent events to return (newest first)."),
        top_error_limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("How many top error buckets to return."),
        tool: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional tool name filter (e.g. `read_note`)."),
      },
      outputSchema: z.object({
        enabled: z.boolean(),
        log_dir: z.string().nullable(),
        log_path: z.string().nullable(),
        scanned_events: z.number().int().nonnegative(),
        matched_events: z.number().int().nonnegative(),
        first_timestamp: z.string().nullable(),
        last_timestamp: z.string().nullable(),
        top_error_types: z.array(
          z.object({
            tool: z.string(),
            error_code: z.string().nullable(),
            error_name: z.string().nullable(),
            count: z.number().int().nonnegative(),
            first_timestamp: z.string(),
            last_timestamp: z.string(),
            sample_message: z.string(),
          }),
        ),
        recent_events: z.array(
          z.object({
            timestamp: z.string(),
            tool: z.string(),
            operation: z.string(),
            input_path: z.string().nullable(),
            resolved_path: z.string().nullable(),
            error: z.object({
              code: z.string().nullable(),
              name: z.string().nullable(),
              message: z.string(),
            }),
            cwd: z.string(),
            vault_root: z.string().nullable(),
            request_id: z.union([z.string(), z.number()]).nullable(),
            session_id: z.string().nullable(),
            correlation_id: z.string().nullable(),
          }),
        ),
      }),
    },
    async (args) => {
      const diagnostics = deps.toolFailureDiagnostics;
      if (!diagnostics) {
        throw new Error("Tool failure diagnostics are unavailable.");
      }

      const report = await diagnostics.getToolFailureReport({
        recentLimit: args.recent_limit,
        topErrorLimit: args.top_error_limit,
        ...(args.tool ? { tool: args.tool } : {}),
      });

      return {
        structuredContent: report,
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    },
  );
}
