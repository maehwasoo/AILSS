// Markdown parsing/chunking utilities
// - chunk by heading-based sections for predictable behavior

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

  // Simple, predictable heading-based parser
  // - toggle when inside code fences to avoid treating '#' as headings
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
        // End current section
        pushCurrent();

        const hashes = headingMatch[1] ?? "";
        const headingText = (headingMatch[2] ?? "").trim();
        if (!hashes || !headingText) {
          // Edge case: regex matched, but captures are empty
          current.buffer.push(line);
          continue;
        }

        const depth = hashes.length;

        // Update heading path
        const nextPath = [...current.headingPath];
        // Trim parent path based on depth
        // - depth=2 (##) corresponds to a path length of 1
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

  // Further split sections by maxChars
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

    // Simple split: accumulate by blank-line paragraphs
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
