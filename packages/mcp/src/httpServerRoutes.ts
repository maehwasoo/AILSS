import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { AilssMcpRuntime } from "./createAilssMcpServer.js";
import type { HttpConfig, ShutdownConfig } from "./httpServerConfig.js";
import {
  baseUrlForRequest,
  extractBearerToken,
  getSingleHeaderValue,
  isInitializeRequestMessage,
  readJsonBody,
} from "./httpServerRequest.js";
import { createSession, McpSessionStore } from "./httpServerSessions.js";

type CreateHttpRequestHandlerOptions = {
  config: HttpConfig;
  runtime: AilssMcpRuntime;
  sessionStore: McpSessionStore;
  enableJsonResponse: boolean;
  shutdown: ShutdownConfig | null;
  isShuttingDown: () => boolean;
  startShuttingDown: () => void;
  close: () => Promise<void>;
};

type JsonRpcErrorData = Record<string, unknown>;

const SESSION_NOT_FOUND_RECOVERY_DATA: JsonRpcErrorData = {
  reason: "session_expired_or_evicted",
  reinitializeRequired: true,
  retryRequest: true,
};

type HttpBoundaryEarlyReturnReason =
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

function extractRequestId(body: unknown): string | number | null {
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

function coerceAcceptHeaderForJsonResponseMode(
  req: IncomingMessage,
  enableJsonResponse: boolean,
): void {
  // SDK requires both types for POST, even when JSON response mode is enabled.
  // Accepting JSON-only clients is safe in JSON response mode because SSE is never used.
  if (!enableJsonResponse) return;
  if ((req.method ?? "").toUpperCase() !== "POST") return;

  const raw = req.headers["accept"];
  const accept = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : "";
  const normalized = accept.toLowerCase();

  const acceptsJson = normalized.includes("application/json");
  const acceptsSse = normalized.includes("text/event-stream");
  const acceptsAny = normalized.includes("*/*");

  if (acceptsJson && acceptsSse) return;

  if (!normalized.trim() || acceptsAny || acceptsJson) {
    req.headers.accept = "application/json, text/event-stream";
  }
}

function hasMcpSessionId(req: IncomingMessage): boolean {
  return getSingleHeaderValue(req, "mcp-session-id") !== null;
}

function logHttpBoundaryEarlyReturnDiagnostic(options: {
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

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function sendText(res: ServerResponse, code: number, message: string): void {
  res.statusCode = code;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

function sendJsonRpcError(
  res: ServerResponse,
  code: number,
  mcpErrorCode: number,
  message: string,
  data?: JsonRpcErrorData,
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
      id: null,
    }),
  );
}

export function createHttpRequestHandler(options: CreateHttpRequestHandlerOptions) {
  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = baseUrlForRequest(req, options.config);
      const requestPath = trimTrailingSlash(url.pathname);
      const configPath = trimTrailingSlash(options.config.path);

      if (requestPath === "/health") {
        sendText(res, 200, "ok");
        return;
      }

      if (options.shutdown && requestPath === trimTrailingSlash(options.shutdown.path)) {
        if (req.method !== "POST") {
          sendText(res, 405, "method not allowed");
          return;
        }

        const token = extractBearerToken(req, url);
        if (token !== options.shutdown.token) {
          logHttpBoundaryEarlyReturnDiagnostic({
            req,
            requestPath,
            status: 401,
            requestId: null,
            reason: "shutdown_unauthorized",
          });
          sendText(res, 401, "unauthorized");
          return;
        }

        if (options.isShuttingDown()) {
          sendText(res, 200, "shutting down");
          return;
        }

        options.startShuttingDown();
        sendText(res, 200, "shutting down");
        setImmediate(() => {
          void options.close().finally(() => {
            if (options.shutdown?.exitProcess) process.exit(0);
          });
        });
        return;
      }

      if (options.isShuttingDown()) {
        if (requestPath === configPath) {
          sendJsonRpcError(res, 503, -32000, "Service is shutting down");
        } else {
          sendText(res, 503, "shutting down");
        }
        return;
      }

      if (requestPath !== configPath) {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 404,
          requestId: null,
          reason: "path_not_found",
        });
        sendText(res, 404, "not found");
        return;
      }

      const token = extractBearerToken(req, url);
      if (token !== options.config.token) {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 401,
          requestId: null,
          reason: "mcp_unauthorized",
        });
        sendJsonRpcError(res, 401, -32000, "Unauthorized");
        return;
      }

      let parsedBody: unknown = undefined;
      let requestId: string | number | null = null;
      if (req.method === "POST") {
        try {
          parsedBody = await readJsonBody(req, 1_000_000);
          requestId = extractRequestId(parsedBody);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Bad request.";
          logHttpBoundaryEarlyReturnDiagnostic({
            req,
            requestPath,
            status: 400,
            requestId: null,
            reason: "invalid_json_body",
          });
          sendJsonRpcError(res, 400, -32000, `Bad Request: ${message}`);
          return;
        }
      }

      if (req.method === "POST" && isInitializeRequestMessage(parsedBody)) {
        options.sessionStore.closeIdleSessions();
        const { server, transport } = await createSession(
          options.runtime,
          options.sessionStore,
          options.enableJsonResponse,
        );
        coerceAcceptHeaderForJsonResponseMode(req, options.enableJsonResponse);
        await transport.handleRequest(
          req as IncomingMessage & { auth?: AuthInfo },
          res,
          parsedBody,
        );
        if (res.statusCode === 406) {
          logHttpBoundaryEarlyReturnDiagnostic({
            req,
            requestPath,
            status: 406,
            requestId,
            reason: "not_acceptable",
          });
        }

        if (transport.sessionId === undefined) {
          await transport.close();
          await server.close();
        }

        return;
      }

      const sessionIdHeader = getSingleHeaderValue(req, "mcp-session-id");
      if (sessionIdHeader === "multiple") {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 400,
          requestId,
          reason: "multiple_session_id_headers",
        });
        sendJsonRpcError(
          res,
          400,
          -32000,
          "Bad Request: Mcp-Session-Id header must be a single value",
        );
        return;
      }
      if (!sessionIdHeader) {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 400,
          requestId,
          reason: "missing_session_id_header",
        });
        sendJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return;
      }

      const session = options.sessionStore.touchSession(sessionIdHeader);
      if (!session) {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 404,
          requestId,
          reason: "session_not_found",
        });
        sendJsonRpcError(res, 404, -32001, "Session not found", SESSION_NOT_FOUND_RECOVERY_DATA);
        return;
      }

      options.sessionStore.closeIdleSessions();
      coerceAcceptHeaderForJsonResponseMode(req, options.enableJsonResponse);
      await session.transport.handleRequest(
        req as IncomingMessage & { auth?: AuthInfo },
        res,
        parsedBody,
      );
      if (res.statusCode === 406) {
        logHttpBoundaryEarlyReturnDiagnostic({
          req,
          requestPath,
          status: 406,
          requestId,
          reason: "not_acceptable",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`[ailss-mcp-http] request error: ${message}`);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32000, "Internal error");
      }
    }
  };
}
