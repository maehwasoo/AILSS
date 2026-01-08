// AILSS note templating helpers
// - frontmatter defaults aligned with docs/vault-ref
// - YAML output via JSON-compatible scalars

import { AILSS_TYPED_LINK_KEYS } from "@ailss/core";

export type AilssFrontmatter = Record<string, unknown>;

function normalizeVaultRelPathForMatching(input: string): string {
  return input.split("\\").join("/").replace(/^\/+/, "");
}

export function isInboxRelPath(vaultRelPath: string): boolean {
  const normalized = normalizeVaultRelPathForMatching(vaultRelPath).trim();
  if (!normalized) return false;
  return normalized === "100. Inbox" || normalized.startsWith("100. Inbox/");
}

export function defaultTagsForRelPath(vaultRelPath: string): string[] {
  return isInboxRelPath(vaultRelPath) ? ["inbox"] : [];
}

export function nowIsoSeconds(): string {
  // ISO without milliseconds/timezone (matches core db metadata style)
  return new Date().toISOString().slice(0, 19);
}

export function idFromIsoSeconds(isoSeconds: string): string {
  // YYYY-MM-DDTHH:mm:ss -> YYYYMMDDHHmmss
  return isoSeconds.replace(/[-:T]/g, "").slice(0, 14);
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isJsonSafeUnquotedYamlString(value: string): boolean {
  // Keep conservative: prefer quoting unless it's simple.
  // - Avoid YAML parsing surprises with ":" "#" leading/trailing spaces, etc.
  return /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(value);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value;
    if (!trimmed) return '""';
    // Avoid YAML type inference pitfalls (numbers, booleans, null-like tokens).
    // - `id: 20260108123456` would parse as a number and break noteId extraction.
    if (/^\d+$/.test(trimmed)) return JSON.stringify(trimmed);
    if (/^(?:true|false|null|~)$/i.test(trimmed)) return JSON.stringify(trimmed);
    if (isJsonSafeUnquotedYamlString(trimmed)) return trimmed;
    return JSON.stringify(trimmed);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  // YAML supports JSON objects, but we avoid emitting complex shapes by default.
  return JSON.stringify(value);
}

function hasOwn(frontmatter: AilssFrontmatter, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(frontmatter, key);
}

export function buildAilssFrontmatter(options: {
  title: string;
  now?: string;
  tags?: string[];
  overrides?: AilssFrontmatter;
  preserve?: AilssFrontmatter;
}): AilssFrontmatter {
  const now = options.now ?? nowIsoSeconds();
  const defaultId = idFromIsoSeconds(now);

  const base: AilssFrontmatter = {
    id: defaultId,
    created: now,
    title: options.title,
    summary: null,
    aliases: [],
    entity: null,
    layer: "conceptual",
    tags: options.tags ?? [],
    keywords: [],
    status: "draft",
    updated: now,
  };

  // Typed links: always present as arrays (stable shape for downstream normalization).
  for (const rel of AILSS_TYPED_LINK_KEYS) {
    (base as Record<string, unknown>)[rel] = [];
  }

  const merged: AilssFrontmatter = { ...base };

  // Preserve values from parsed input, but only for keys that exist on the object.
  // - avoids pulling in prototype values / undefined defaults
  if (options.preserve) {
    for (const [k, v] of Object.entries(options.preserve)) {
      if (!hasOwn(options.preserve, k)) continue;
      (merged as Record<string, unknown>)[k] = v;
    }
  }

  // Explicit overrides win last.
  if (options.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      if (!hasOwn(options.overrides, k)) continue;
      (merged as Record<string, unknown>)[k] = v;
    }
  }

  // Ensure required keys exist even if preserve/overrides were missing them.
  for (const [k, v] of Object.entries(base)) {
    if (!hasOwn(merged, k)) (merged as Record<string, unknown>)[k] = v;
  }
  for (const rel of AILSS_TYPED_LINK_KEYS) {
    if (!hasOwn(merged, rel)) (merged as Record<string, unknown>)[rel] = [];
  }

  // Ensure core identity fields stay in the expected types even when preserving
  // existing frontmatter (YAML parsers may infer numbers for unquoted scalars).
  const coercedId = coerceNonEmptyString((merged as Record<string, unknown>).id);
  (merged as Record<string, unknown>).id = coercedId ?? defaultId;

  return merged;
}

export function renderFrontmatterYaml(frontmatter: AilssFrontmatter): string {
  // Stable key order: align with docs/vault-ref template + append extra typed-link keys.
  const orderedKeys = [
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
    "instance_of",
    "part_of",
    "uses",
    "depends_on",
    "implements",
    "see_also",
    "cites",
    "authored_by",
    "supersedes",
    "same_as",
  ] satisfies string[];

  const lines: string[] = [];
  for (const key of orderedKeys) {
    const value = (frontmatter as Record<string, unknown>)[key];
    const serialized = yamlScalar(value);
    if (!serialized) lines.push(`${key}:`);
    else lines.push(`${key}: ${serialized}`);
  }

  // Any remaining keys (user-provided) come last in stable order.
  const remaining = Object.keys(frontmatter)
    .filter((k) => !orderedKeys.includes(k))
    .sort((a, b) => a.localeCompare(b));

  for (const key of remaining) {
    const serialized = yamlScalar((frontmatter as Record<string, unknown>)[key]);
    if (!serialized) lines.push(`${key}:`);
    else lines.push(`${key}: ${serialized}`);
  }

  return lines.join("\n");
}

export function renderMarkdownWithFrontmatter(options: {
  frontmatter: AilssFrontmatter;
  body: string;
}): string {
  const yaml = renderFrontmatterYaml(options.frontmatter);
  const body = (options.body ?? "").replace(/^\n+/, "");
  return `---\n${yaml}\n---\n\n${body}`;
}
