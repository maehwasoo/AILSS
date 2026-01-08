// search_vault tool
// - filesystem text search over vault markdown files

import { promises as fs } from "node:fs";
import path from "node:path";

import { listMarkdownFiles } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

type Match = {
  line: number;
  column: number;
  preview: string;
};

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function findLineMatchesSubstring(
  line: string,
  needle: string,
  caseSensitive: boolean,
  maxMatches: number,
): Match[] {
  const out: Match[] = [];
  const haystack = caseSensitive ? line : line.toLowerCase();
  const query = caseSensitive ? needle : needle.toLowerCase();

  let from = 0;
  while (out.length < maxMatches) {
    const idx = haystack.indexOf(query, from);
    if (idx < 0) break;
    out.push({ line: 0, column: idx + 1, preview: line });
    from = idx + Math.max(1, query.length);
  }

  return out;
}

function findLineMatchesRegex(line: string, re: RegExp, maxMatches: number): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;

  while (out.length < maxMatches) {
    const m = re.exec(line);
    if (!m) break;
    out.push({ line: 0, column: (m.index ?? 0) + 1, preview: line });
    if (m[0]?.length === 0) re.lastIndex += 1;
  }

  return out;
}

export function registerSearchVaultTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "search_vault",
    {
      title: "Search vault (text)",
      description:
        "Searches vault markdown files for a query string (or regex). Requires AILSS_VAULT_PATH. Ignores vault-internal/system folders (e.g. .obsidian, .ailss).",
      inputSchema: {
        query: z.string().min(1).describe("Search query (substring or regex pattern)"),
        regex: z.boolean().default(false).describe("Treat query as a regex pattern"),
        case_sensitive: z.boolean().default(false).describe("Case sensitive matching"),
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only search notes under this vault-relative path prefix"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum matches to return"),
        max_matches_per_file: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("Maximum matches to return per file"),
      },
      outputSchema: z.object({
        query: z.string(),
        regex: z.boolean(),
        case_sensitive: z.boolean(),
        path_prefix: z.string().nullable(),
        files_scanned: z.number().int().nonnegative(),
        truncated: z.boolean(),
        results: z.array(
          z.object({
            path: z.string(),
            matches: z.array(
              z.object({
                line: z.number().int().positive(),
                column: z.number().int().positive(),
                preview: z.string(),
              }),
            ),
          }),
        ),
      }),
    },
    async (args) => {
      const vaultPath = deps.vaultPath;
      if (!vaultPath) {
        throw new Error("Cannot search vault because AILSS_VAULT_PATH is not set.");
      }

      const files = await listMarkdownFiles(vaultPath);
      const prefix = args.path_prefix ? args.path_prefix.trim() : null;

      const flags = `${args.case_sensitive ? "" : "i"}g`;
      const re = args.regex ? new RegExp(args.query, flags) : null;

      const byPath = new Map<string, Match[]>();
      let totalMatches = 0;
      let filesScanned = 0;
      let truncated = false;

      for (const absPath of files) {
        const relPath = relPathFromAbs(vaultPath, absPath);
        if (prefix && !relPath.startsWith(prefix)) continue;

        filesScanned += 1;

        const text = await fs.readFile(absPath, "utf8");
        const lines = text.split(/\r?\n/);

        const fileMatches: Match[] = [];
        for (let i = 0; i < lines.length; i += 1) {
          if (fileMatches.length >= args.max_matches_per_file) break;
          if (totalMatches >= args.max_results) {
            truncated = true;
            break;
          }

          const line = lines[i] ?? "";
          const found = re
            ? findLineMatchesRegex(line, re, args.max_matches_per_file - fileMatches.length)
            : findLineMatchesSubstring(
                line,
                args.query,
                args.case_sensitive,
                args.max_matches_per_file - fileMatches.length,
              );

          for (const m of found) {
            if (totalMatches >= args.max_results) {
              truncated = true;
              break;
            }
            fileMatches.push({ ...m, line: i + 1 });
            totalMatches += 1;
          }

          if (truncated) break;
        }

        if (fileMatches.length > 0) byPath.set(relPath, fileMatches);
        if (truncated) break;
      }

      const results = Array.from(byPath.entries()).map(([path, matches]) => ({ path, matches }));
      const payload = {
        query: args.query,
        regex: Boolean(args.regex),
        case_sensitive: Boolean(args.case_sensitive),
        path_prefix: prefix,
        files_scanned: filesScanned,
        truncated,
        results,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
