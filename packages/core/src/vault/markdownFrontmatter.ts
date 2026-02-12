import matter from "gray-matter";

export type MarkdownFrontmatter = Record<string, unknown>;

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

type FrontmatterSplit = { frontmatterRaw: string; body: string };

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

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
