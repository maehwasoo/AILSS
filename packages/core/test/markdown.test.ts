// 마크다운 파싱/청킹 테스트

import { describe, expect, it } from "vitest";

import { chunkMarkdownByHeadings, parseMarkdownNote } from "../src/vault/markdown.js";

describe("parseMarkdownNote()", () => {
  it("프론트매터(front matter)와 본문(body)을 분리해요", () => {
    const input = `---
title: Hello
tags:
  - a
---

# H1

본문이에요.
`;

    const parsed = parseMarkdownNote(input);

    expect(parsed.frontmatter).toMatchObject({ title: "Hello" });
    expect(parsed.body).toContain("# H1");
    expect(parsed.body).toContain("본문이에요.");
  });
});

describe("chunkMarkdownByHeadings()", () => {
  it("code fence 내부의 헤딩(#)은 섹션 분할로 취급하지 않아요", () => {
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

  it("maxChars를 넘으면 문단 단위로 추가 분할해요", () => {
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
