import type { ServerResponse } from "node:http";

export type JsonRpcErrorData = Record<string, unknown>;

export function extractRequestId(body: unknown): string | number | null {
  if (Array.isArray(body)) {
    for (const entry of body) {
      const requestId = extractRequestId(entry);
      if (requestId !== null) return requestId;
    }
    return null;
  }

  if (typeof body !== "object" || body === null) return null;

  const id = (body as Record<string, unknown>)["id"];
  if (typeof id === "string") return id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  return null;
}

export function isJsonRpcNotificationOnlyBody(body: unknown): boolean {
  if (Array.isArray(body)) {
    if (body.length === 0) return false;
    return body.every((entry) => isJsonRpcNotificationOnlyBody(entry));
  }

  if (typeof body !== "object" || body === null) return false;
  const record = body as Record<string, unknown>;

  if (record["jsonrpc"] !== "2.0") return false;
  if (typeof record["method"] !== "string") return false;
  if (record["method"].length === 0) return false;

  // Notifications are JSON-RPC requests without an `id`.
  return !("id" in record);
}

export function sendJsonRpcError(
  res: ServerResponse,
  code: number,
  mcpErrorCode: number,
  message: string,
  data?: JsonRpcErrorData,
  requestId: string | number | null = null,
): void {
  const errorPayload: { code: number; message: string; data?: JsonRpcErrorData } = {
    code: mcpErrorCode,
    message,
  };
  if (data !== undefined) {
    errorPayload.data = data;
  }

  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: errorPayload,
      id: requestId,
    }),
  );
}
