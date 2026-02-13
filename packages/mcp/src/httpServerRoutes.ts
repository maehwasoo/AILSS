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
        sendText(res, 404, "not found");
        return;
      }

      const token = extractBearerToken(req, url);
      if (token !== options.config.token) {
        sendJsonRpcError(res, 401, -32000, "Unauthorized");
        return;
      }

      let parsedBody: unknown = undefined;
      if (req.method === "POST") {
        try {
          parsedBody = await readJsonBody(req, 1_000_000);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Bad request.";
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
        await transport.handleRequest(
          req as IncomingMessage & { auth?: AuthInfo },
          res,
          parsedBody,
        );

        if (transport.sessionId === undefined) {
          await transport.close();
          await server.close();
        }

        return;
      }

      const sessionIdHeader = getSingleHeaderValue(req, "mcp-session-id");
      if (sessionIdHeader === "multiple") {
        sendJsonRpcError(
          res,
          400,
          -32000,
          "Bad Request: Mcp-Session-Id header must be a single value",
        );
        return;
      }
      if (!sessionIdHeader) {
        sendJsonRpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return;
      }

      const session = options.sessionStore.touchSession(sessionIdHeader);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, "Session not found", SESSION_NOT_FOUND_RECOVERY_DATA);
        return;
      }

      options.sessionStore.closeIdleSessions();
      await session.transport.handleRequest(
        req as IncomingMessage & { auth?: AuthInfo },
        res,
        parsedBody,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`[ailss-mcp-http] request error: ${message}`);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32000, "Internal error");
      }
    }
  };
}
