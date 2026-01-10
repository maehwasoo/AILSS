// suggest_typed_links tool
// - suggests frontmatter typed-link candidates using existing body wikilinks (rel=links_to)

import { getNoteMeta, resolveNotePathsByWikilinkTarget, AILSS_TYPED_LINK_KEYS } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

const ENTITY_HINT_USES = new Set(["tool", "software", "dataset"]);

function wikilinkTargetForPath(notePath: string): string {
  const normalized = notePath.split("\\").join("/").replace(/^\/+/, "");
  return normalized.toLowerCase().endsWith(".md") ? normalized.slice(0, -3) : normalized;
}

function suggestedWikilinkForResolved(options: {
  resolved: ReturnType<typeof resolveNotePathsByWikilinkTarget>;
  fallbackWikilink: string;
}): string {
  if (options.resolved.length !== 1) return options.fallbackWikilink;
  const only = options.resolved[0];
  if (!only) return options.fallbackWikilink;

  const target = wikilinkTargetForPath(only.path);
  const title = (only.title ?? "").trim();
  if (!target) return options.fallbackWikilink;
  if (!title || title === target) return `[[${target}]]`;
  return `[[${target}|${title}]]`;
}

export function registerSuggestTypedLinksTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "suggest_typed_links",
    {
      title: "Suggest typed links",
      description:
        "Suggests frontmatter typed-link candidates for a note using already-indexed body wikilinks (rel=links_to) and target note metadata. Works without AILSS_VAULT_PATH (DB-only).",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path to suggest links for"),
        max_links_to_consider: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(500)
          .describe("Maximum number of body wikilinks (links_to) to consider (safety bound)"),
        max_suggestions: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe("Maximum number of suggestions returned (safety bound)"),
        max_resolutions_per_target: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Maximum resolved note paths per target"),
      },
      outputSchema: z.object({
        seed_path: z.string(),
        seed_title: z.string().nullable(),
        params: z.object({
          max_links_to_consider: z.number().int(),
          max_suggestions: z.number().int(),
          max_resolutions_per_target: z.number().int(),
        }),
        skipped_broken: z.number().int().nonnegative(),
        skipped_existing: z.number().int().nonnegative(),
        suggestions: z.array(
          z.object({
            rel: z.string(),
            target: z.string(),
            suggested_wikilink: z.string(),
            source_wikilink: z.string(),
            resolved: z.array(
              z.object({
                path: z.string(),
                title: z.string().nullable(),
                matched_by: z.union([z.literal("path"), z.literal("note_id"), z.literal("title")]),
              }),
            ),
            reason: z.string(),
          }),
        ),
      }),
    },
    async (args) => {
      const seed = getNoteMeta(deps.db, args.path);
      if (!seed) {
        throw new Error(
          `Note metadata not found for path="${args.path}". Re-run indexing so suggestions are available.`,
        );
      }

      const existingByRel = new Map<string, Set<string>>();
      for (const rel of AILSS_TYPED_LINK_KEYS) {
        existingByRel.set(rel, new Set<string>());
      }
      for (const link of seed.typedLinks) {
        const set = existingByRel.get(link.rel);
        if (!set) continue;
        set.add(link.toTarget);
      }

      const linksTo = seed.typedLinks
        .filter((l) => l.rel === "links_to")
        .slice(0, args.max_links_to_consider);

      const resolveCache = new Map<string, ReturnType<typeof resolveNotePathsByWikilinkTarget>>();
      const resolveCached = (
        target: string,
      ): ReturnType<typeof resolveNotePathsByWikilinkTarget> => {
        if (resolveCache.has(target)) return resolveCache.get(target) ?? [];
        const resolved = resolveNotePathsByWikilinkTarget(
          deps.db,
          target,
          args.max_resolutions_per_target,
        );
        resolveCache.set(target, resolved);
        return resolved;
      };

      const metaCache = new Map<string, ReturnType<typeof getNoteMeta> | null>();
      const getMetaCached = (notePath: string): ReturnType<typeof getNoteMeta> | null => {
        if (metaCache.has(notePath)) return metaCache.get(notePath) ?? null;
        const meta = getNoteMeta(deps.db, notePath);
        metaCache.set(notePath, meta);
        return meta;
      };

      const suggestions: Array<{
        rel: string;
        target: string;
        suggested_wikilink: string;
        source_wikilink: string;
        resolved: Array<{
          path: string;
          title: string | null;
          matched_by: "path" | "note_id" | "title";
        }>;
        reason: string;
      }> = [];

      let skippedBroken = 0;
      let skippedExisting = 0;

      for (const link of linksTo) {
        if (suggestions.length >= args.max_suggestions) break;
        const target = (link.toTarget ?? "").trim();
        if (!target) continue;

        const resolved = resolveCached(target);
        if (resolved.length === 0) {
          skippedBroken += 1;
          continue;
        }

        const resolvedPath = resolved[0]?.path ?? "";
        if (!resolvedPath || resolvedPath === seed.path) continue;

        const targetMeta = getMetaCached(resolvedPath);
        const targetEntity = (targetMeta?.entity ?? "").trim().toLowerCase();
        const rel = ENTITY_HINT_USES.has(targetEntity) ? "uses" : "see_also";

        const existingSet = existingByRel.get(rel);
        if (existingSet && existingSet.has(target)) {
          skippedExisting += 1;
          continue;
        }

        const suggestedWikilink = suggestedWikilinkForResolved({
          resolved,
          fallbackWikilink: link.toWikilink,
        });

        suggestions.push({
          rel,
          target,
          suggested_wikilink: suggestedWikilink,
          source_wikilink: link.toWikilink,
          resolved: resolved.map((r) => ({
            path: r.path,
            title: r.title,
            matched_by: r.matchedBy,
          })),
          reason:
            rel === "uses" && targetMeta?.entity
              ? `target entity=${JSON.stringify(targetMeta.entity)}`
              : "default see_also from body wikilink",
        });
      }

      const payload = {
        seed_path: seed.path,
        seed_title: seed.title,
        params: {
          max_links_to_consider: args.max_links_to_consider,
          max_suggestions: args.max_suggestions,
          max_resolutions_per_target: args.max_resolutions_per_target,
        },
        skipped_broken: skippedBroken,
        skipped_existing: skippedExisting,
        suggestions,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
