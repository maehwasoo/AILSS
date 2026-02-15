export function parseFirstMcpPayload(body: string): unknown {
  const normalized = (body ?? "").trim();
  if (!normalized) {
    throw new Error("Expected response body to be non-empty");
  }

  // SSE mode: `text/event-stream` with `data: { ... }`
  const dataLine = normalized
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("data: "));
  if (dataLine) {
    return JSON.parse(dataLine.slice("data: ".length)) as unknown;
  }

  // JSON response mode: `application/json` with a plain JSON-RPC payload.
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse MCP response body as SSE or JSON: ${message}. Body: ${normalized.slice(
        0,
        500,
      )}`,
    );
  }
}

// Backwards-compatible alias (historically SSE-only).
export const parseFirstSseData = parseFirstMcpPayload;
