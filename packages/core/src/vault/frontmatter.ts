// AILSS frontmatter utilities
// - normalization for stable indexing and querying

import { AILSS_TYPED_LINK_KEYS } from "./typedLinkOntology.js";

export { AILSS_TYPED_LINK_KEYS };
export type { AilssTypedLinkKey } from "./typedLinkOntology.js";

export type TypedLink = {
  rel: string;
  toTarget: string;
  toWikilink: string;
  position: number;
};

// Frontmatter enums
// - keep in sync with docs/standards/vault/frontmatter-schema.md
export const AILSS_FRONTMATTER_STATUS_VALUES = [
  "draft",
  "in-review",
  "active",
  "archived",
] as const;
export type AilssFrontmatterStatus = (typeof AILSS_FRONTMATTER_STATUS_VALUES)[number];

export const AILSS_FRONTMATTER_LAYER_VALUES = [
  "strategic",
  "conceptual",
  "logical",
  "physical",
  "operational",
] as const;
export type AilssFrontmatterLayer = (typeof AILSS_FRONTMATTER_LAYER_VALUES)[number];

export const AILSS_FRONTMATTER_ENTITY_VALUES = [
  // Interface entities
  "interface",
  "pipeline",
  "procedure",
  "dashboard",
  "checklist",
  "workflow",

  // Action entities
  "decide",
  "review",
  "plan",
  "implement",
  "approve",
  "reject",
  "observe",
  "measure",
  "test",
  "verify",
  "learn",
  "research",
  "summarize",
  "publish",
  "meet",
  "audit",
  "deploy",
  "rollback",
  "refactor",
  "design",
  "delete",
  "update",
  "create",
  "schedule",
  "migrate",
  "analyze",

  // Object entities
  "concept",
  "document",
  "project",
  "artifact",
  "person",
  "organization",
  "place",
  "event",
  "task",
  "method",
  "tool",
  "idea",
  "principle",
  "heuristic",
  "pattern",
  "definition",
  "question",
  "software",
  "dataset",
  "reference",
  "hub",
  "guide",
  "log",
  "structure",
  "architecture",
] as const;
export type AilssFrontmatterEntity = (typeof AILSS_FRONTMATTER_ENTITY_VALUES)[number];

const AILSS_FRONTMATTER_STATUS_SET = new Set<string>(AILSS_FRONTMATTER_STATUS_VALUES);
const AILSS_FRONTMATTER_LAYER_SET = new Set<string>(AILSS_FRONTMATTER_LAYER_VALUES);
const AILSS_FRONTMATTER_ENTITY_SET = new Set<string>(AILSS_FRONTMATTER_ENTITY_VALUES);

export function isAilssFrontmatterStatus(value: string): value is AilssFrontmatterStatus {
  return AILSS_FRONTMATTER_STATUS_SET.has(value);
}

export function isAilssFrontmatterLayer(value: string): value is AilssFrontmatterLayer {
  return AILSS_FRONTMATTER_LAYER_SET.has(value);
}

export function isAilssFrontmatterEntity(value: string): value is AilssFrontmatterEntity {
  return AILSS_FRONTMATTER_ENTITY_SET.has(value);
}

export type AilssFrontmatterEnumViolation = {
  key: "status" | "layer" | "entity";
  value: string | null;
  allowed: readonly string[];
};

export function validateAilssFrontmatterEnums(
  frontmatter: Record<string, unknown>,
): AilssFrontmatterEnumViolation[] {
  const violations: AilssFrontmatterEnumViolation[] = [];
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(frontmatter, key);
  const describeValue = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value instanceof Date && Number.isFinite(value.getTime()))
      return value.toISOString().slice(0, 19);
    try {
      const json = JSON.stringify(value);
      if (typeof json === "string") return json;
    } catch {
      // ignore
    }
    return String(value);
  };

  if (hasOwn("status")) {
    const value = frontmatter.status;
    const raw = coerceString(value);
    if (!raw || !isAilssFrontmatterStatus(raw)) {
      violations.push({
        key: "status",
        value: describeValue(value),
        allowed: AILSS_FRONTMATTER_STATUS_VALUES,
      });
    }
  }

  if (hasOwn("layer")) {
    const value = frontmatter.layer;
    const raw = coerceString(value);
    const isUnset =
      value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (!isUnset && (!raw || !isAilssFrontmatterLayer(raw))) {
      violations.push({
        key: "layer",
        value: describeValue(value),
        allowed: AILSS_FRONTMATTER_LAYER_VALUES,
      });
    }
  }

  if (hasOwn("entity")) {
    const value = frontmatter.entity;
    const raw = coerceString(value);
    const isUnset =
      value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (!isUnset && (!raw || !isAilssFrontmatterEntity(raw))) {
      violations.push({
        key: "entity",
        value: describeValue(value),
        allowed: AILSS_FRONTMATTER_ENTITY_VALUES,
      });
    }
  }

  return violations;
}

export type NormalizedAilssNoteMeta = {
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  keywords: string[];
  sources: string[];
  frontmatter: Record<string, unknown>;
  typedLinks: TypedLink[];
};

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  // YAML parsers (e.g. gray-matter/js-yaml) may infer types for unquoted scalars.
  // - `id: 20260108123456` becomes a number
  // - `created: 2026-01-08T12:34:56` becomes a Date
  // The AILSS vault convention treats these fields as strings, so coerce them here.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    // Keep the existing convention: ISO to seconds, no ms/timezone suffix.
    return value.toISOString().slice(0, 19);
  }

  return null;
}

function flattenUnknownToStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((v) => flattenUnknownToStrings(v));
  return [];
}

function normalizeStringList(value: unknown): string[] {
  const values = flattenUnknownToStrings(value)
    .map((v) => v.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    deduped.push(v);
  }

  return deduped;
}

function isWikilink(value: string): boolean {
  return value.startsWith("[[") && value.endsWith("]]");
}

export function toWikilink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "[[]]";
  if (isWikilink(trimmed)) return trimmed;
  return `[[${trimmed}]]`;
}

export function wikilinkTarget(value: string): string {
  const wikilink = toWikilink(value);
  const inner = wikilink.slice(2, -2).trim();
  const noDisplay = inner.split("|")[0]?.trim() ?? "";
  const noHeading = noDisplay.split("#")[0]?.trim() ?? "";
  return noHeading || noDisplay || inner;
}

export function normalizeTypedLinkTargetInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return wikilinkTarget(trimmed);
}

export function normalizeAilssNoteMeta(
  frontmatter: Record<string, unknown>,
): NormalizedAilssNoteMeta {
  const tags = normalizeStringList(frontmatter.tags);
  const keywords = normalizeStringList(frontmatter.keywords);
  const sources = normalizeStringList(frontmatter.source);

  const typedLinks: TypedLink[] = [];
  for (const rel of AILSS_TYPED_LINK_KEYS) {
    const rawValues = normalizeStringList(frontmatter[rel]);
    for (const [i, raw] of rawValues.entries()) {
      const normalizedWikilink = toWikilink(raw);
      typedLinks.push({
        rel,
        toTarget: wikilinkTarget(normalizedWikilink),
        toWikilink: normalizedWikilink,
        position: i,
      });
    }
  }

  // Normalized frontmatter JSON
  // - stable arrays for tags/keywords/typed-links
  const normalizedFrontmatter: Record<string, unknown> = { ...frontmatter };
  normalizedFrontmatter.tags = tags;
  normalizedFrontmatter.keywords = keywords;
  normalizedFrontmatter.source = sources;
  for (const rel of AILSS_TYPED_LINK_KEYS) {
    const values = normalizeStringList(frontmatter[rel]).map(toWikilink);
    normalizedFrontmatter[rel] = values;
  }

  return {
    noteId: coerceString(frontmatter.id),
    created: coerceString(frontmatter.created),
    title: coerceString(frontmatter.title),
    summary: coerceString(frontmatter.summary),
    entity: coerceString(frontmatter.entity),
    layer: coerceString(frontmatter.layer),
    status: coerceString(frontmatter.status),
    updated: coerceString(frontmatter.updated),
    tags,
    keywords,
    sources,
    frontmatter: normalizedFrontmatter,
    typedLinks,
  };
}
