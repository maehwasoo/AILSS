// Markdown parsing/chunking tests

import { describe, expect, it } from "vitest";

import { chunkMarkdownByHeadings, parseMarkdownNote } from "../src/vault/markdown.js";

describe("parseMarkdownNote()", () => {
  it("splits frontmatter and body", () => {
    const input = `---
title: Hello
tags:
  - a
---

# H1

This is the body.
`;

    const parsed = parseMarkdownNote(input);

    expect(parsed.frontmatter).toMatchObject({ title: "Hello" });
    expect(parsed.body).toContain("# H1");
    expect(parsed.body).toContain("This is the body.");
  });
});

describe("chunkMarkdownByHeadings()", () => {
  it("does not treat headings inside code fences as section boundaries", () => {
    const body = `
# A
alpha

\`\`\`ts
# not heading
\`\`\`

## B
bravo
`.trim();

    const chunks = chunkMarkdownByHeadings(body, { maxChars: 4000 });

    expect(chunks.map((c) => c.heading)).toEqual(["A", "B"]);
    expect(chunks[0]?.content).toContain("# not heading");
    expect(chunks[0]?.headingPath).toEqual(["A"]);
    expect(chunks[1]?.headingPath).toEqual(["A", "B"]);
  });

  it("splits further by paragraphs when exceeding maxChars", () => {
    const body = `
# A
paragraph-1-12345

paragraph-2-12345

paragraph-3-12345
`.trim();

    const chunks = chunkMarkdownByHeadings(body, { maxChars: 25 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.heading === "A")).toBe(true);
  });
});
