import { parseFirstMcpPayload } from "./httpTestUtils.js";

export const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

export async function mcpInitializeRaw(options: {
  url: string;
  token: string;
  clientName: string;
  accept: string;
}): Promise<{
  status: number;
  contentType: string;
  sessionId: string | null;
  body: string;
  payload: unknown;
}> {
  const res = await fetch(options.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: options.accept,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: options.clientName, version: "0" },
      },
    }),
  });

  const status = res.status;
  const contentType = res.headers.get("content-type") ?? "";
  const sessionId = res.headers.get("mcp-session-id");

  const body = await res.text();
  const payload = parseFirstMcpPayload(body);
  return { status, contentType, sessionId, body, payload };
}
