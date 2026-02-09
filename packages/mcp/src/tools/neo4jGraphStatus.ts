// neo4j_graph_status tool
// - optional Neo4j availability and consistency checks

import { getSqliteGraphCounts, readNeo4jGraphStatus } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

export function registerNeo4jGraphStatusTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "neo4j_graph_status",
    {
      title: "Neo4j graph status",
      description:
        "Returns optional Neo4j graph mirror status and SQLite↔Neo4j consistency checks. When Neo4j is disabled/unavailable, reports a non-fatal fallback status.",
      inputSchema: {},
      outputSchema: z.object({
        enabled: z.boolean(),
        configured: z.boolean(),
        available: z.boolean(),
        sync_on_index: z.boolean(),
        strict_mode: z.boolean(),
        reason: z.string().nullable(),
        active_run_id: z.string().nullable(),
        mirror_status: z.enum(["empty", "ok", "error"]),
        last_success_at: z.string().nullable(),
        last_error: z.string().nullable(),
        last_error_at: z.string().nullable(),
        sqlite_counts: z.object({
          notes: z.number().int().nonnegative(),
          typed_links: z.number().int().nonnegative(),
        }),
        neo4j_counts: z
          .object({
            notes: z.number().int().nonnegative(),
            typed_links: z.number().int().nonnegative(),
            targets: z.number().int().nonnegative(),
            resolved_links: z.number().int().nonnegative(),
          })
          .nullable(),
        consistent: z.boolean().nullable(),
      }),
    },
    async () => {
      const neo4j = deps.neo4j ?? {
        enabled: false,
        syncOnIndex: false,
        strictMode: false,
        config: null,
        unavailableReason: "Neo4j integration is not configured in this MCP runtime.",
      };
      const sqliteCounts = getSqliteGraphCounts(deps.db);

      const basePayload = {
        enabled: neo4j.enabled,
        configured: Boolean(neo4j.config),
        available: false,
        sync_on_index: neo4j.syncOnIndex,
        strict_mode: neo4j.strictMode,
        reason: neo4j.unavailableReason,
        active_run_id: null as string | null,
        mirror_status: "empty" as "empty" | "ok" | "error",
        last_success_at: null as string | null,
        last_error: null as string | null,
        last_error_at: null as string | null,
        sqlite_counts: {
          notes: sqliteCounts.notes,
          typed_links: sqliteCounts.typedLinks,
        },
        neo4j_counts: null as {
          notes: number;
          typed_links: number;
          targets: number;
          resolved_links: number;
        } | null,
        consistent: null as boolean | null,
      };

      if (!neo4j.enabled || !neo4j.config) {
        return {
          structuredContent: basePayload,
          content: [{ type: "text", text: JSON.stringify(basePayload, null, 2) }],
        };
      }

      try {
        const status = await readNeo4jGraphStatus(deps.db, neo4j.config);
        const payload = {
          ...basePayload,
          available: true,
          reason: null,
          active_run_id: status.activeRunId,
          mirror_status: status.mirrorStatus,
          last_success_at: status.lastSuccessAt,
          last_error: status.lastError,
          last_error_at: status.lastErrorAt,
          neo4j_counts: {
            notes: status.neo4jCounts.notes,
            typed_links: status.neo4jCounts.typedLinks,
            targets: status.neo4jCounts.targets,
            resolved_links: status.neo4jCounts.resolvedLinks,
          },
          consistent: status.consistent,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const payload = {
          ...basePayload,
          reason: `Neo4j unavailable: ${message}`,
          mirror_status: "error" as "empty" | "ok" | "error",
          last_error: message,
        };
        return {
          structuredContent: payload,
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }
    },
  );
}
