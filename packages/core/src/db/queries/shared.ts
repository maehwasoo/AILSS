export function safeParseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return value as number[];
  }
  if (typeof value === "string" || value instanceof Uint8Array) {
    try {
      const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "number")) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

export function safeParseJsonObject(input: string): Record<string, unknown> {
  try {
    const value = JSON.parse(input);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function safeParseJsonArray(input: string): string[] {
  try {
    const value = JSON.parse(input);
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
    return [];
  } catch {
    return [];
  }
}

export function normalizeStringList(input: string | string[] | undefined): string[] | undefined {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input;
  return undefined;
}

function escapeSqlLikeLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function toLiteralPrefixLikePattern(prefix: string): string {
  return `${escapeSqlLikeLiteral(prefix)}%`;
}

export function normalizeFilterStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}
