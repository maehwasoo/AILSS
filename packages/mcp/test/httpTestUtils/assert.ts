export function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
}

export function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array`);
  }
}

export function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string`);
  }
}

export function getStructuredContent(payload: unknown): Record<string, unknown> {
  assertRecord(payload, "JSON-RPC payload");
  const error = payload["error"];
  if (error !== undefined) {
    throw new Error(`JSON-RPC error response: ${JSON.stringify(error)}`);
  }
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  const structured = result["structuredContent"];
  if (structured === undefined) {
    throw new Error(`Missing structuredContent. JSON-RPC result: ${JSON.stringify(result)}`);
  }
  assertRecord(structured, "structuredContent");
  return structured;
}
