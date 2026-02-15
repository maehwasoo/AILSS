export type FrontmatterSplit = {
  body: string;
};

export function normalizeNewlines(input: string): string {
  return (input ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function splitFrontmatter(markdown: string): FrontmatterSplit | null {
  const normalized = normalizeNewlines(markdown);
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

  return {
    body: lines.slice(end + 1).join("\n"),
  };
}
