import { describe, expect, it } from "vitest";

import { AILSS_TYPED_LINK_KEYS } from "@ailss/core";
import { promises as fs } from "node:fs";
import path from "node:path";

const KEY_ORDER_LABEL = "Canonical relation key order (for tooling/tests):";

const DOC_PATHS = [
  "docs/standards/vault/typed-links.md",
  "docs/standards/vault/frontmatter-schema.md",
  "docs/standards/vault/assistant-workflow.md",
  "docs/ops/codex-skills/prometheus-agent/SKILL.md",
] as const;

function extractCanonicalKeyOrder(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(KEY_ORDER_LABEL));
  if (start < 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const line = lines[start] ?? "";
  const matches = line.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const key = (match[1] ?? "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

describe("Docs typed-link ontology consistency", () => {
  it("keeps canonical relation key order in sync across docs and skill guidance", async () => {
    const canonical = [...AILSS_TYPED_LINK_KEYS];
    const mismatches: Array<{ file: string; found: string[] }> = [];

    for (const relPath of DOC_PATHS) {
      const absPath = path.join(process.cwd(), relPath);
      const markdown = await fs.readFile(absPath, "utf8");
      const extracted = extractCanonicalKeyOrder(markdown);
      if (extracted.length === 0 || extracted.join("\n") !== canonical.join("\n")) {
        mismatches.push({ file: relPath, found: extracted });
      }
    }

    if (mismatches.length > 0) {
      const details = mismatches.map((m) => {
        const found = m.found.length > 0 ? m.found.join(", ") : "(missing marker)";
        return `- ${m.file}\n  expected: ${canonical.join(", ")}\n  found: ${found}`;
      });
      throw new Error(
        [
          "Typed-link ontology key order mismatch detected.",
          `Expected marker: "${KEY_ORDER_LABEL}"`,
          ...details,
        ].join("\n"),
      );
    }

    expect(mismatches).toEqual([]);
  });
});
