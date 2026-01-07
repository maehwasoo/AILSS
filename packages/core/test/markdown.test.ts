// Markdown parsing/chunking tests

import { describe, expect, it } from "vitest";

import {
  chunkMarkdownByHeadings,
  extractWikilinkTypedLinksFromMarkdownBody,
  parseMarkdownNote,
} from "../src/vault/markdown.js";

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

  it("accepts unquoted Obsidian wikilinks in YAML frontmatter lists", () => {
    const input = `---
title: Hello
aliases:
  - [[HOUME-CLIENT 마이페이지 성능 병목 분석과 개선]]
---

# Body

Text.
`;

    const parsed = parseMarkdownNote(input);

    expect(parsed.frontmatter.title).toBe("Hello");
    expect(parsed.frontmatter.aliases).toEqual([
      "[[HOUME-CLIENT 마이페이지 성능 병목 분석과 개선]]",
    ]);
    expect(parsed.body).toContain("# Body");
  });

  it("does not fail indexing when YAML frontmatter is invalid", () => {
    const input = `---
title Hello
aliases:
  - [[Bad YAML]]
---

# Body
`;

    const parsed = parseMarkdownNote(input);

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toContain("# Body");
    expect(parsed.body).not.toContain("title Hello");
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

describe("extractWikilinkTypedLinksFromMarkdownBody()", () => {
  it("extracts Obsidian [[wikilinks]] from markdown body and ignores code fences", () => {
    const body = `
# H1
Link to [[Note A]] and [[Note B|Alias]].
Duplicate: [[Note A]]
Embed: ![[Embed Note]]

\`\`\`md
[[Not a link]]
\`\`\`
`.trim();

    const links = extractWikilinkTypedLinksFromMarkdownBody(body);

    expect(links.map((l) => l.rel)).toEqual(["links_to", "links_to", "links_to"]);
    expect(links.map((l) => l.toTarget)).toEqual(["Note A", "Note B", "Embed Note"]);
    expect(links.map((l) => l.position)).toEqual([0, 1, 2]);
  });
});
