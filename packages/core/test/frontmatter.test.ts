// AILSS frontmatter normalization tests

import { describe, expect, it } from "vitest";

import { normalizeAilssNoteMeta, parseMarkdownNote } from "../src/index.js";

describe("normalizeAilssNoteMeta()", () => {
  it("normalizes quoted typed links into stable targets", () => {
    const input = `---
title: Hello
tags:
  - inbox
keywords:
  - llm
part_of:
  - "[[WorldAce]]"
depends_on:
  - "[[Vite]]"
---

Body
`;

    const parsed = parseMarkdownNote(input);
    const meta = normalizeAilssNoteMeta(parsed.frontmatter);

    expect(meta.title).toBe("Hello");
    expect(meta.tags).toEqual(["inbox"]);
    expect(meta.keywords).toEqual(["llm"]);

    expect(meta.typedLinks).toEqual([
      { rel: "part_of", toTarget: "WorldAce", toWikilink: "[[WorldAce]]", position: 0 },
      { rel: "depends_on", toTarget: "Vite", toWikilink: "[[Vite]]", position: 0 },
    ]);
  });

  it("handles unquoted Obsidian wikilinks (YAML nested arrays)", () => {
    const input = `---
part_of: [[WorldAce]]
instance_of:
  - [[concept]]
---

Body
`;

    const parsed = parseMarkdownNote(input);
    const meta = normalizeAilssNoteMeta(parsed.frontmatter);

    expect(meta.frontmatter.part_of).toEqual(["[[WorldAce]]"]);
    expect(meta.frontmatter.instance_of).toEqual(["[[concept]]"]);

    expect(meta.typedLinks).toEqual([
      { rel: "instance_of", toTarget: "concept", toWikilink: "[[concept]]", position: 0 },
      { rel: "part_of", toTarget: "WorldAce", toWikilink: "[[WorldAce]]", position: 0 },
    ]);
  });

  it("coerces YAML-inferred scalars (id as number, created/updated as Date)", () => {
    const input = `---
id: 20260108123456
created: 2026-01-08T12:34:56
updated: 2026-01-08 12:34:56
title: Hello
---

Body
`;

    const parsed = parseMarkdownNote(input);
    expect(typeof parsed.frontmatter.id).toBe("number");
    expect(Object.prototype.toString.call(parsed.frontmatter.created)).toBe("[object Date]");
    expect(Object.prototype.toString.call(parsed.frontmatter.updated)).toBe("[object Date]");

    const meta = normalizeAilssNoteMeta(parsed.frontmatter);
    expect(meta.noteId).toBe("20260108123456");
    expect(meta.created).toBe("2026-01-08T12:34:56");
    expect(meta.updated).toBe("2026-01-08T12:34:56");
  });

  it("normalizes source (trim + dedupe) into a stable string list", () => {
    const input = `---
title: Hello
source:
  - " https://example.com/a "
  - "https://example.com/a"
  - "doi:10.1234/xyz "
  - ""
---

Body
`;

    const parsed = parseMarkdownNote(input);
    const meta = normalizeAilssNoteMeta(parsed.frontmatter);

    expect(meta.frontmatter.source).toEqual(["https://example.com/a", "doi:10.1234/xyz"]);
  });
});
