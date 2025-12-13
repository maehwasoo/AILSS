// 마크다운(markdown) 파싱/청킹(chunking) 유틸
// - 고수준 구현을 위해 heading 기반 섹션 단위로 나눠요

import { createHash } from "node:crypto";
import matter from "gray-matter";

export type MarkdownFrontmatter = Record<string, unknown>;

export type MarkdownChunk = {
  chunkId: string;
  content: string;
  contentSha256: string;
  heading: string | null;
  headingPath: string[];
};

export type ParsedMarkdownNote = {
  frontmatter: MarkdownFrontmatter;
  body: string;
};

export function parseMarkdownNote(markdown: string): ParsedMarkdownNote {
  const parsed = matter(markdown);
  return {
    frontmatter: (parsed.data ?? {}) as MarkdownFrontmatter,
    body: parsed.content ?? "",
  };
}

function sha256Text(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

export type ChunkMarkdownOptions = {
  maxChars: number;
};

export function chunkMarkdownByHeadings(
  bodyMarkdown: string,
  options: ChunkMarkdownOptions = { maxChars: 4000 },
): MarkdownChunk[] {
  const body = normalizeNewlines(bodyMarkdown).trim();
  if (!body) return [];

  // 단순하면서도 예측 가능한 heading 기반 파서
  // - code fence 내부의 # 헤딩 오탐을 최소화하려고 fence 토글을 적용
  const lines = body.split("\n");

  type Section = {
    heading: string | null;
    headingDepth: number | null;
    headingPath: string[];
    buffer: string[];
  };

  const sections: Section[] = [];
  let current: Section = {
    heading: null,
    headingDepth: null,
    headingPath: [],
    buffer: [],
  };

  let inFence = false;

  function pushCurrent() {
    const content = current.buffer.join("\n").trim();
    if (!content) return;
    sections.push({ ...current, buffer: [content] });
  }

  for (const line of lines) {
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      inFence = !inFence;
    }

    if (!inFence) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        // 섹션 종료
        pushCurrent();

        const hashes = headingMatch[1] ?? "";
        const headingText = (headingMatch[2] ?? "").trim();
        if (!hashes || !headingText) {
          // 예외 케이스: 정규식 매칭은 되었지만 캡처가 비어있을 때
          current.buffer.push(line);
          continue;
        }

        const depth = hashes.length;

        // heading path 갱신
        const nextPath = [...current.headingPath];
        // depth 기반으로 상위 경로 잘라내기
        // - depth=2면 1단계(##)에 해당하므로 길이를 1로 맞춤
        const keepLen = Math.max(0, depth - 1);
        nextPath.splice(keepLen);
        nextPath.push(headingText);

        current = {
          heading: headingText,
          headingDepth: depth,
          headingPath: nextPath,
          buffer: [],
        };
        continue;
      }
    }

    current.buffer.push(line);
  }

  pushCurrent();

  // 섹션을 maxChars 기준으로 추가 분할
  const chunks: MarkdownChunk[] = [];
  for (const section of sections) {
    const fullText = section.buffer.join("\n").trim();
    if (!fullText) continue;

    if (fullText.length <= options.maxChars) {
      const contentSha256 = sha256Text(fullText);
      chunks.push({
        chunkId: contentSha256,
        content: fullText,
        contentSha256,
        heading: section.heading,
        headingPath: section.headingPath,
      });
      continue;
    }

    // 간단 분할: 빈 줄 단위(문단)로 누적
    const paragraphs = fullText.split(/\n{2,}/g);
    let buffer = "";
    for (const paragraph of paragraphs) {
      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (next.length > options.maxChars && buffer) {
        const contentSha256 = sha256Text(buffer);
        chunks.push({
          chunkId: contentSha256,
          content: buffer,
          contentSha256,
          heading: section.heading,
          headingPath: section.headingPath,
        });
        buffer = paragraph;
        continue;
      }
      buffer = next;
    }

    if (buffer.trim()) {
      const contentSha256 = sha256Text(buffer);
      chunks.push({
        chunkId: contentSha256,
        content: buffer,
        contentSha256,
        heading: section.heading,
        headingPath: section.headingPath,
      });
    }
  }

  return chunks;
}
