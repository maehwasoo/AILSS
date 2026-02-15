import type { IncomingMessage } from "node:http";

type ParsedAcceptMediaRange = {
  type: string;
  subtype: string;
  q: number;
  hasNonQParams: boolean;
};

type GetEffectiveQForMediaTypeOptions = {
  // Missing Accept header implies "*/*" per RFC; pass `false` for truly missing/empty Accept.
  acceptHeaderPresent: boolean;
  // When true, ignore media-range parameters other than `q` (e.g. `profile=v1`) for matching.
  // Useful for deciding whether "generic" representations are acceptable.
  ignoreRangesWithNonQParams?: boolean;
};

function parseAcceptHeaderValue(value: string): ParsedAcceptMediaRange[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part): ParsedAcceptMediaRange | null => {
      const [rangeRaw, ...paramParts] = part.split(";").map((p) => p.trim());
      const range = (rangeRaw ?? "").trim().toLowerCase();
      if (!range) return null;

      const [typeRaw, subtypeRaw] = range.split("/").map((t) => t.trim());
      if (!typeRaw || !subtypeRaw) return null;

      let q = 1;
      let hasNonQParams = false;
      let hasParsedQ = false;
      for (const param of paramParts) {
        if (!param) continue;

        const m = param.match(/^q\s*=\s*(.+)$/i);
        if (m?.[1]) {
          if (!hasParsedQ) {
            const n = Number.parseFloat(m[1].trim());
            q = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
            hasParsedQ = true;
          }
          continue;
        }

        hasNonQParams = true;
      }

      return { type: typeRaw, subtype: subtypeRaw, q, hasNonQParams };
    })
    .filter((value): value is ParsedAcceptMediaRange => value !== null);
}

function getEffectiveQForMediaType(
  ranges: ParsedAcceptMediaRange[],
  targetType: string,
  targetSubtype: string,
  options?: GetEffectiveQForMediaTypeOptions,
): number {
  // Per RFC, a missing Accept header is treated like "*/*".
  // Note: do not infer "missing" from `ranges.length === 0` when we intentionally filtered.
  const acceptHeaderPresent = options?.acceptHeaderPresent ?? ranges.length > 0;
  if (!acceptHeaderPresent) return 1;

  const ignoreRangesWithNonQParams = options?.ignoreRangesWithNonQParams ?? false;

  let exactQ = 0;
  let hasExact = false;
  let typeWildcardQ = 0;
  let hasTypeWildcard = false;
  let anyWildcardQ = 0;
  let hasAnyWildcard = false;

  for (const range of ranges) {
    if (ignoreRangesWithNonQParams && range.hasNonQParams) continue;

    if (range.type === targetType && range.subtype === targetSubtype) {
      exactQ = Math.max(exactQ, range.q);
      hasExact = true;
      continue;
    }

    if (range.type === targetType && range.subtype === "*") {
      typeWildcardQ = Math.max(typeWildcardQ, range.q);
      hasTypeWildcard = true;
      continue;
    }

    if (range.type === "*" && range.subtype === "*") {
      anyWildcardQ = Math.max(anyWildcardQ, range.q);
      hasAnyWildcard = true;
    }
  }

  if (hasExact) return exactQ;
  if (hasTypeWildcard) return typeWildcardQ;
  if (hasAnyWildcard) return anyWildcardQ;
  return 0;
}

function hasAnyMatchingMediaRange(
  ranges: ParsedAcceptMediaRange[],
  targetType: string,
  targetSubtype: string,
  options?: GetEffectiveQForMediaTypeOptions,
): boolean {
  const acceptHeaderPresent = options?.acceptHeaderPresent ?? ranges.length > 0;
  if (!acceptHeaderPresent) return false;

  const ignoreRangesWithNonQParams = options?.ignoreRangesWithNonQParams ?? false;

  for (const range of ranges) {
    if (ignoreRangesWithNonQParams && range.hasNonQParams) continue;
    if (range.type === targetType && range.subtype === targetSubtype) return true;
    if (range.type === targetType && range.subtype === "*") return true;
    if (range.type === "*" && range.subtype === "*") return true;
  }

  return false;
}

function getRawAcceptHeaderValue(req: IncomingMessage): string {
  const raw = req.headers["accept"];
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "string") return raw;
  return "";
}

export function selectTransportEnableJsonResponseForInitializeRequest(
  req: IncomingMessage,
  serverEnableJsonResponse: boolean,
): boolean {
  // If server config forces SSE, never use JSON.
  if (!serverEnableJsonResponse) return false;

  const accept = getRawAcceptHeaderValue(req);
  const ranges = parseAcceptHeaderValue(accept);
  const acceptHeaderPresent = accept.trim().length > 0;

  const acceptsGenericJsonQ = getEffectiveQForMediaType(ranges, "application", "json", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });
  if (acceptsGenericJsonQ > 0) return true;

  // SSE-only Accept is treated as a signal to use SSE response mode for the session.
  const acceptsSseQ = getEffectiveQForMediaType(ranges, "text", "event-stream", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });
  if (acceptsSseQ > 0) return false;

  // Default to server-selected mode (JSON) so the SDK can produce a 406 if nothing is acceptable.
  return true;
}

export function coerceAcceptHeaderForStreamableHttpTransport(
  req: IncomingMessage,
  transportEnableJsonResponse: boolean,
): void {
  // SDK requires both types for POST, even when JSON response mode is enabled.
  const method = (req.method ?? "").toUpperCase();

  // Streamable HTTP standalone SSE (GET) is required for server-initiated messages, and the SDK
  // rejects GET requests missing `text/event-stream` even if the client could handle it.
  if (method === "GET") {
    const accept = getRawAcceptHeaderValue(req);
    const ranges = parseAcceptHeaderValue(accept);
    const acceptHeaderPresent = accept.trim().length > 0;

    // Only coerce when the client actually accepts SSE (via wildcards, or missing Accept),
    // but the SDK's simplistic check would otherwise reject the request.
    const acceptsSseQ = getEffectiveQForMediaType(ranges, "text", "event-stream", {
      acceptHeaderPresent,
      ignoreRangesWithNonQParams: true,
    });
    if (acceptsSseQ <= 0) return;

    const hasExplicitSse = ranges.some((range) => {
      return range.type === "text" && range.subtype === "event-stream" && range.q > 0;
    });
    if (hasExplicitSse) return;

    const parts: string[] = [];
    const trimmed = accept.trim();
    if (trimmed) parts.push(trimmed);
    parts.push("text/event-stream");
    req.headers.accept = parts.join(", ");
    return;
  }

  if (method !== "POST") return;

  const accept = getRawAcceptHeaderValue(req);
  const ranges = parseAcceptHeaderValue(accept);

  const acceptHeaderPresent = accept.trim().length > 0;
  const acceptsGenericJsonQ = getEffectiveQForMediaType(ranges, "application", "json", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });
  const acceptsSseQ = getEffectiveQForMediaType(ranges, "text", "event-stream", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });

  if (transportEnableJsonResponse) {
    // Never coerce clients that don't accept generic JSON when we'll respond with JSON.
    if (acceptsGenericJsonQ <= 0) return;
  } else {
    // Never coerce clients that don't accept SSE when we'll respond with SSE.
    if (acceptsSseQ <= 0) return;
  }

  const jsonHasMatch = hasAnyMatchingMediaRange(ranges, "application", "json", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });
  const sseHasMatch = hasAnyMatchingMediaRange(ranges, "text", "event-stream", {
    acceptHeaderPresent,
    ignoreRangesWithNonQParams: true,
  });

  // Do not override explicit q=0 rejections (e.g. "application/json;q=0", "text/*;q=0").
  const jsonExplicitlyRejected = jsonHasMatch && acceptsGenericJsonQ <= 0;
  const sseExplicitlyRejected = sseHasMatch && acceptsSseQ <= 0;

  const hasExplicitJson = ranges.some((range) => {
    return range.type === "application" && range.subtype === "json";
  });
  const hasExplicitSse = ranges.some((range) => {
    return range.type === "text" && range.subtype === "event-stream";
  });

  const needsJson = !hasExplicitJson && !jsonExplicitlyRejected;
  const needsSse = !hasExplicitSse && !sseExplicitlyRejected;
  if (!needsJson && !needsSse) return;

  const parts: string[] = [];
  const trimmed = accept.trim();
  if (trimmed) parts.push(trimmed);
  if (needsJson) parts.push("application/json");
  if (needsSse) parts.push("text/event-stream");

  req.headers.accept = parts.join(", ");
}
