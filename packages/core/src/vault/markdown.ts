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
  const split = splitFrontmatter(markdown);
  if (!split) {
    return { frontmatter: {}, body: markdown ?? "" };
  }

  const sanitizedFrontmatter = sanitizeFrontmatterForWikilinks(split.frontmatterRaw);
  const sanitized = `---\n${sanitizedFrontmatter}\n---\n${split.body}`;

  try {
    const parsed = matter(sanitized);
    return {
      frontmatter: (parsed.data ?? {}) as MarkdownFrontmatter,
      body: parsed.content ?? "",
    };
  } catch {
    // Tolerant fallback: strip the frontmatter block but keep indexing the note
    return { frontmatter: {}, body: split.body };
  }
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
  const maxChars = Math.max(1, options.maxChars);
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

    if (fullText.length <= maxChars) {
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

    const hardSplit = (text: string): string[] => {
      const parts: string[] = [];
      for (let start = 0; start < text.length; start += maxChars) {
        parts.push(text.slice(start, start + maxChars));
      }
      return parts;
    };

    const splitOversizedParagraph = (paragraph: string): string[] => {
      if (paragraph.length <= maxChars) return [paragraph];

      // Newline packing, then hard split
      const parts: string[] = [];
      const lines = paragraph.split("\n");

      let lineBuffer = "";
      const flush = (): void => {
        if (lineBuffer.trim()) parts.push(lineBuffer);
        lineBuffer = "";
      };

      for (const line of lines) {
        const next = lineBuffer ? `${lineBuffer}\n${line}` : line;
        if (next.length > maxChars && lineBuffer) {
          flush();
          lineBuffer = line;
        } else {
          lineBuffer = next;
        }

        if (lineBuffer.length > maxChars) {
          const hardParts = hardSplit(lineBuffer);
          parts.push(...hardParts.slice(0, -1));
          lineBuffer = hardParts[hardParts.length - 1] ?? "";
        }
      }

      flush();
      return parts;
    };

    const pushChunk = (text: string): void => {
      const content = text.trim();
      if (!content) return;
      const contentSha256 = sha256Text(content);
      chunks.push({
        chunkId: contentSha256,
        content,
        contentSha256,
        heading: section.heading,
        headingPath: section.headingPath,
      });
    };

    const flushBuffer = (): void => {
      if (!buffer.trim()) return;
      pushChunk(buffer);
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      if (paragraph.length > maxChars) {
        flushBuffer();
        for (const part of splitOversizedParagraph(paragraph)) {
          pushChunk(part);
        }
        buffer = "";
        continue;
      }

      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (next.length > maxChars && buffer) {
        flushBuffer();
        buffer = paragraph;
        continue;
      }
      buffer = next;
    }

    flushBuffer();
  }

  return chunks;
}

type FrontmatterSplit = { frontmatterRaw: string; body: string };

function splitFrontmatter(markdown: string): FrontmatterSplit | null {
  const normalized = normalizeNewlines(markdown ?? "");
  const input = normalized.startsWith("\ufeff") ? normalized.slice(1) : normalized;
  if (!input.startsWith("---\n")) return null;

  const lines = input.split("\n");
  if ((lines[0] ?? "") !== "---") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line === "---" || line === "...") {
      end = i;
      break;
    }
  }

  if (end === -1) return null;

  const frontmatterRaw = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");
  return { frontmatterRaw, body };
}

function sanitizeFrontmatterForWikilinks(frontmatterRaw: string): string {
  // Quote unquoted Obsidian wikilinks in YAML frontmatter.
  // - YAML treats leading `[` as flow collection syntax; `[[...]]` often causes parse errors.
  // - We rewrite:
  //   - `- [[Note]]` -> `- "[[Note]]"`
  //   - `key: [[Note]]` -> `key: "[[Note]]"`
  const lines = normalizeNewlines(frontmatterRaw ?? "").split("\n");

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line;

      // List item
      const listMatch = line.match(/^(\s*-\s*)(\[\[[^\r\n]*\]\])(\s*(#.*)?)$/);
      if (listMatch) {
        const prefix = listMatch[1] ?? "";
        const value = listMatch[2] ?? "";
        const suffix = listMatch[3] ?? "";
        return `${prefix}"${value}"${suffix}`;
      }

      // Key-value (single-line scalar)
      const kvMatch = line.match(/^(\s*[^:\r\n]+:\s*)(\[\[[^\r\n]*\]\])(\s*(#.*)?)$/);
      if (kvMatch) {
        const prefix = kvMatch[1] ?? "";
        const value = kvMatch[2] ?? "";
        const suffix = kvMatch[3] ?? "";
        return `${prefix}"${value}"${suffix}`;
      }

      return line;
    })
    .join("\n");
}
