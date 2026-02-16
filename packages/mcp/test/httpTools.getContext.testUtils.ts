import { assertArray, assertRecord, assertString } from "./httpTestUtils.js";

const DEFAULT_TOP_K_ENV_KEY = "AILSS_GET_CONTEXT_DEFAULT_TOP_K";

export const TEST_TOKEN = "test-token";

function getCallToolResult(payload: unknown): Record<string, unknown> {
  assertRecord(payload, "JSON-RPC payload");
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  return result;
}

export function throwIfToolCallFailed(payload: unknown): void {
  const result = getCallToolResult(payload);
  if (!result["isError"]) return;

  const content = result["content"];
  assertArray(content, "result.content");
  const first = content[0];
  assertRecord(first, "result.content[0]");
  const text = first["type"] === "text" ? first["text"] : JSON.stringify(first);
  assertString(text, "result.content[0].text");
  throw new Error(`get_context failed: ${text}`);
}

export async function withGetContextDefaultTopKEnv(
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[DEFAULT_TOP_K_ENV_KEY];
  if (value === undefined) {
    delete process.env[DEFAULT_TOP_K_ENV_KEY];
  } else {
    process.env[DEFAULT_TOP_K_ENV_KEY] = value;
  }

  try {
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[DEFAULT_TOP_K_ENV_KEY];
    } else {
      process.env[DEFAULT_TOP_K_ENV_KEY] = prev;
    }
  }
}
