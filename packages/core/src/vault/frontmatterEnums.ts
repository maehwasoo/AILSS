// AILSS frontmatter enums + enum validation
// - single source for status/layer/entity value constraints
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

function coerceFrontmatterEnumString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  // YAML parsers (e.g. gray-matter/js-yaml) may infer types for unquoted scalars.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 19);
  }

  return null;
}

function describeEnumValue(value: unknown): string | null {
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
}

export function validateAilssFrontmatterEnums(
  frontmatter: Record<string, unknown>,
): AilssFrontmatterEnumViolation[] {
  const violations: AilssFrontmatterEnumViolation[] = [];
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(frontmatter, key);

  if (hasOwn("status")) {
    const value = frontmatter.status;
    const raw = coerceFrontmatterEnumString(value);
    if (!raw || !isAilssFrontmatterStatus(raw)) {
      violations.push({
        key: "status",
        value: describeEnumValue(value),
        allowed: AILSS_FRONTMATTER_STATUS_VALUES,
      });
    }
  }

  if (hasOwn("layer")) {
    const value = frontmatter.layer;
    const raw = coerceFrontmatterEnumString(value);
    const isUnset =
      value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (!isUnset && (!raw || !isAilssFrontmatterLayer(raw))) {
      violations.push({
        key: "layer",
        value: describeEnumValue(value),
        allowed: AILSS_FRONTMATTER_LAYER_VALUES,
      });
    }
  }

  if (hasOwn("entity")) {
    const value = frontmatter.entity;
    const raw = coerceFrontmatterEnumString(value);
    const isUnset =
      value === null || value === undefined || (typeof value === "string" && !value.trim());
    if (!isUnset && (!raw || !isAilssFrontmatterEntity(raw))) {
      violations.push({
        key: "entity",
        value: describeEnumValue(value),
        allowed: AILSS_FRONTMATTER_ENTITY_VALUES,
      });
    }
  }

  return violations;
}
