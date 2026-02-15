export function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (!value) return '""';
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    const serialized = yamlScalar(value);
    if (!serialized) lines.push(`${key}:`);
    else lines.push(`${key}: ${serialized}`);
  }
  return lines.join("\n");
}

export function renderMarkdownWithFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  return `---\n${renderFrontmatterYaml(frontmatter)}\n---\n${body}`;
}
