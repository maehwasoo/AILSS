// frontmatter_validate tool
// - filesystem scan + YAML frontmatter presence checks

import {
  AILSS_FRONTMATTER_ENTITY_VALUES,
  AILSS_FRONTMATTER_LAYER_VALUES,
  AILSS_FRONTMATTER_STATUS_VALUES,
} from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";
import { scanVaultNotesForFrontmatterValidate } from "../lib/frontmatterValidate/scanVaultNotes.js";
import type { TypedLinkDiagnostic } from "../lib/frontmatterValidate/types.js";
import { collectTypedLinkDiagnostics } from "../lib/frontmatterValidate/typedLinkDiagnostics.js";

const REQUIRED_KEYS = [
  "id",
  "created",
  "title",
  "summary",
  "aliases",
  "entity",
  "layer",
  "tags",
  "keywords",
  "status",
  "updated",
  "source",
] as const;

const TYPED_LINK_CONSTRAINT_MODES = ["off", "warn", "error"] as const;

export function registerFrontmatterValidateTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "frontmatter_validate",
    {
      title: "Frontmatter validate",
      description:
        "Scans vault markdown notes and validates YAML frontmatter presence + required key presence, `id`/`created` consistency, and optional typed-link ontology constraints.",
      inputSchema: {
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only validate notes under this vault-relative path prefix"),
        max_files: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .default(20_000)
          .describe("Hard limit on files scanned (safety bound)"),
        typed_link_constraint_mode: z
          .enum(TYPED_LINK_CONSTRAINT_MODES)
          .default("warn")
          .describe(
            "Typed-link constraint mode: off (skip), warn (report diagnostics), error (count diagnostics as validation failures).",
          ),
      },
      outputSchema: z.object({
        path_prefix: z.string().nullable(),
        files_scanned: z.number().int().nonnegative(),
        ok_count: z.number().int().nonnegative(),
        issue_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        enum_schema: z.object({
          status: z.array(z.string()),
          layer: z.array(z.string()),
          entity: z.array(z.string()),
        }),
        typed_link_constraint_mode: z.enum(TYPED_LINK_CONSTRAINT_MODES),
        typed_link_diagnostic_count: z.number().int().nonnegative(),
        typed_link_diagnostics: z.array(
          z.object({
            path: z.string(),
            rel: z.string(),
            target: z.string().nullable(),
            reason: z.string(),
            fix_hint: z.string(),
            severity: z.union([z.literal("warn"), z.literal("error")]),
          }),
        ),
        required_keys: z.array(z.string()),
        issues: z.array(
          z.object({
            path: z.string(),
            has_frontmatter: z.boolean(),
            parsed_frontmatter: z.boolean(),
            missing_keys: z.array(z.string()),
            id_value: z.string().nullable(),
            created_value: z.string().nullable(),
            id_format_ok: z.boolean(),
            created_format_ok: z.boolean(),
            id_matches_created: z.boolean(),
            enum_violations: z.array(
              z.object({
                key: z.enum(["status", "layer", "entity"]),
                value: z.string().nullable(),
              }),
            ),
            typed_link_diagnostics: z.array(
              z.object({
                path: z.string(),
                rel: z.string(),
                target: z.string().nullable(),
                reason: z.string(),
                fix_hint: z.string(),
                severity: z.union([z.literal("warn"), z.literal("error")]),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      const vaultPath = deps.vaultPath;
      if (!vaultPath) {
        throw new Error("Cannot validate frontmatter because AILSS_VAULT_PATH is not set.");
      }

      const prefix = args.path_prefix ? args.path_prefix.trim() : null;

      const scan = await scanVaultNotesForFrontmatterValidate({
        vaultPath,
        pathPrefix: prefix,
        maxFiles: args.max_files,
        requiredKeys: REQUIRED_KEYS,
      });

      const typedLinkDiagnostics =
        args.typed_link_constraint_mode === "off"
          ? []
          : collectTypedLinkDiagnostics(
              scan.scannedNotes,
              scan.targetLookupNotes,
              args.typed_link_constraint_mode,
            );

      const diagnosticsByPath = new Map<string, TypedLinkDiagnostic[]>();
      for (const diag of typedLinkDiagnostics) {
        const existing = diagnosticsByPath.get(diag.path) ?? [];
        existing.push(diag);
        diagnosticsByPath.set(diag.path, existing);
      }

      const issues: Array<{
        path: string;
        has_frontmatter: boolean;
        parsed_frontmatter: boolean;
        missing_keys: string[];
        id_value: string | null;
        created_value: string | null;
        id_format_ok: boolean;
        created_format_ok: boolean;
        id_matches_created: boolean;
        enum_violations: Array<{ key: "status" | "layer" | "entity"; value: string | null }>;
        typed_link_diagnostics: TypedLinkDiagnostic[];
      }> = [];

      let okCount = 0;
      for (const note of scan.scannedNotes) {
        const noteDiagnostics = diagnosticsByPath.get(note.path) ?? [];
        const hasConstraintError =
          args.typed_link_constraint_mode === "error" && noteDiagnostics.length > 0;

        const baseIsOk =
          note.has_frontmatter &&
          note.parsed_frontmatter &&
          note.missing_keys.length === 0 &&
          note.enum_violations.length === 0 &&
          note.id_format_ok &&
          note.created_format_ok &&
          note.id_matches_created;
        const isOk = baseIsOk && !hasConstraintError;

        if (isOk) {
          okCount += 1;
          continue;
        }

        issues.push({
          path: note.path,
          has_frontmatter: note.has_frontmatter,
          parsed_frontmatter: note.parsed_frontmatter,
          missing_keys: note.missing_keys,
          id_value: note.id_value,
          created_value: note.created_value,
          id_format_ok: note.id_format_ok,
          created_format_ok: note.created_format_ok,
          id_matches_created: note.id_matches_created,
          enum_violations: note.enum_violations,
          typed_link_diagnostics: noteDiagnostics,
        });
      }

      const payload = {
        path_prefix: prefix,
        files_scanned: scan.filesScanned,
        ok_count: okCount,
        issue_count: issues.length,
        truncated: scan.truncated,
        enum_schema: {
          status: [...AILSS_FRONTMATTER_STATUS_VALUES],
          layer: [...AILSS_FRONTMATTER_LAYER_VALUES],
          entity: [...AILSS_FRONTMATTER_ENTITY_VALUES],
        },
        typed_link_constraint_mode: args.typed_link_constraint_mode,
        typed_link_diagnostic_count: typedLinkDiagnostics.length,
        typed_link_diagnostics: typedLinkDiagnostics,
        required_keys: REQUIRED_KEYS.slice(),
        issues,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
