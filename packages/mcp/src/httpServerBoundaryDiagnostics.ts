import type { IncomingMessage } from "node:http";

import { getSingleHeaderValue } from "./httpServerRequest.js";

export type HttpBoundaryEarlyReturnReason =
  | "shutdown_unauthorized"
  | "path_not_found"
  | "mcp_unauthorized"
  | "invalid_json_body"
  | "multiple_session_id_headers"
  | "missing_session_id_header"
  | "session_not_found"
  | "not_acceptable";

type HttpBoundaryDiagnosticEvent = {
  event: "mcp_http_boundary_early_return";
  timestamp: string;
  status: 400 | 401 | 404 | 406;
  request_id: string | number | null;
  method: string;
  path: string;
  accept: string | null;
  has_mcp_session_id: boolean;
  reason: HttpBoundaryEarlyReturnReason;
};

function getAcceptHeader(req: IncomingMessage): string | null {
  const accept = getSingleHeaderValue(req, "accept");
  if (typeof accept === "string") return accept;
  if (accept === "multiple") {
    const raw = req.headers.accept;
    if (Array.isArray(raw)) return raw.join(", ");
    return "multiple";
  }
  return null;
}

function hasMcpSessionId(req: IncomingMessage): boolean {
  return getSingleHeaderValue(req, "mcp-session-id") !== null;
}

export function logHttpBoundaryEarlyReturnDiagnostic(options: {
  req: IncomingMessage;
  requestPath: string;
  status: 400 | 401 | 404 | 406;
  requestId: string | number | null;
  reason: HttpBoundaryEarlyReturnReason;
}): void {
  const event: HttpBoundaryDiagnosticEvent = {
    event: "mcp_http_boundary_early_return",
    timestamp: new Date().toISOString(),
    status: options.status,
    request_id: options.requestId,
    method: options.req.method ?? "UNKNOWN",
    path: options.requestPath,
    accept: getAcceptHeader(options.req),
    has_mcp_session_id: hasMcpSessionId(options.req),
    reason: options.reason,
  };

  console.warn(JSON.stringify(event));
}
