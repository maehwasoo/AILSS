// Shared frontmatter identity helpers

export function hasFrontmatterBlock(markdown: string): boolean {
  const normalized = (markdown ?? "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return false;
  const endIdx = normalized.indexOf("\n---\n", 4);
  const endDotsIdx = normalized.indexOf("\n...\n", 4);
  return endIdx >= 0 || endDotsIdx >= 0;
}

export function idFromCreated(created: string): string | null {
  const trimmed = created.trim();
  if (!trimmed) return null;

  // ISO prefix parsing
  const iso = trimmed.length >= 19 ? trimmed.slice(0, 19) : trimmed;
  const normalized = iso.replace(/ /g, "T");
  const digits = normalized.replace(/[-:T]/g, "");
  if (digits.length < 14) return null;
  return digits.slice(0, 14);
}

export function coerceTrimmedStringOrEmpty(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

export function coerceNonEmptyString(value: unknown): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return value.toISOString().slice(0, 19);
  }
  const coerced = coerceTrimmedStringOrEmpty(value);
  if (coerced === null || coerced === "") return null;
  return coerced;
}
