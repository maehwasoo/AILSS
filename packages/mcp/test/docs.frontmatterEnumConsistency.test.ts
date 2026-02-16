import { describe, expect, it } from "vitest";

import {
  AILSS_FRONTMATTER_ENTITY_VALUES,
  AILSS_FRONTMATTER_LAYER_VALUES,
  AILSS_FRONTMATTER_STATUS_VALUES,
} from "@ailss/core";
import { promises as fs } from "node:fs";
import path from "node:path";

const DOC_PATH = "docs/standards/vault/frontmatter-schema.md";

type EnumKey = "status" | "layer" | "entity";

const EXPECTED_BY_KEY: Record<EnumKey, readonly string[]> = {
  status: [...AILSS_FRONTMATTER_STATUS_VALUES],
  layer: [...AILSS_FRONTMATTER_LAYER_VALUES],
  entity: [...AILSS_FRONTMATTER_ENTITY_VALUES],
};

function extractTemplateCodeBlock(markdown: string): string {
  const match = markdown.match(/```(?:[a-zA-Z]+)?\r?\n([\s\S]*?)\r?\n```/);
  if (!match || !match[1]) return "";
  return match[1];
}

function extractEnumValuesFromTemplate(template: string, key: EnumKey): string[] {
  const lines = template.split(/\r?\n/);
  const keyIndex = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`));
  if (keyIndex < 0) return [];

  const precedingComments: string[] = [];
  for (let i = keyIndex - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("#")) break;
    precedingComments.push(trimmed.slice(1).trim());
  }

  const enumLine = precedingComments[precedingComments.length - 1];
  if (!enumLine) return [];
  return enumLine
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeValues(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

describe("Docs frontmatter enum consistency", () => {
  it("keeps frontmatter enum lists in docs in sync with core constants", async () => {
    const absPath = path.join(process.cwd(), DOC_PATH);
    const markdown = await fs.readFile(absPath, "utf8");
    const template = extractTemplateCodeBlock(markdown);

    const mismatches: Array<{
      key: EnumKey;
      expected: string[];
      found: string[];
      missing: string[];
      extra: string[];
    }> = [];

    for (const [key, expectedValues] of Object.entries(EXPECTED_BY_KEY) as Array<
      [EnumKey, readonly string[]]
    >) {
      const expected = normalizeValues(expectedValues);
      const found = normalizeValues(extractEnumValuesFromTemplate(template, key));
      const foundSet = new Set<string>(found);
      const expectedSet = new Set<string>(expected);
      const missing = expected.filter((value) => !foundSet.has(value));
      const extra = found.filter((value) => !expectedSet.has(value));
      if (missing.length > 0 || extra.length > 0) {
        mismatches.push({ key, expected, found, missing, extra });
      }
    }

    if (mismatches.length > 0) {
      const details = mismatches.map((mismatch) => {
        const missing = mismatch.missing.length > 0 ? mismatch.missing.join(", ") : "(none)";
        const extra = mismatch.extra.length > 0 ? mismatch.extra.join(", ") : "(none)";
        const found = mismatch.found.length > 0 ? mismatch.found.join(", ") : "(missing marker)";
        return [
          `- ${mismatch.key}`,
          `  missing: ${missing}`,
          `  extra: ${extra}`,
          `  expected: ${mismatch.expected.join(", ")}`,
          `  found: ${found}`,
        ].join("\n");
      });
      throw new Error(
        [
          "Frontmatter enum drift detected between code and docs.",
          `- file: ${DOC_PATH}`,
          ...details,
        ].join("\n"),
      );
    }

    expect(mismatches).toEqual([]);
  });
});
