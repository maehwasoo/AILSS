// AILSS MCP server - Streamable HTTP server (localhost)
// - intended to be hosted by the Obsidian plugin and consumed by Codex via URL + token

import http, { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import {
  createAilssMcpRuntimeFromEnv,
  createAilssMcpServerFromRuntime,
  type AilssMcpRuntime,
} from "./createAilssMcpServer.js";

export type HttpConfig = {
  host: string;
  port: number;
  path: string;
  token: string;
};

export type StartHttpServerOptions = {
  runtime: AilssMcpRuntime;
  config: HttpConfig;
  maxSessions?: number;
  idleTtlMs?: number;
};

type McpSession = {
  sessionId: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAtMs: number;
  lastSeenAtMs: number;
};

export function requireLocalhostHost(host: string): void {
  if (host === "127.0.0.1") return;
  if (host === "localhost") return;
  if (host === "::1") return;
  throw new Error(`Refusing to bind MCP HTTP server to non-localhost host: "${host}"`);
}

export function parseHttpConfigFromEnv(): HttpConfig {
  const host = (process.env.AILSS_MCP_HTTP_HOST ?? "127.0.0.1").trim();
  requireLocalhostHost(host);

  const portRaw = (process.env.AILSS_MCP_HTTP_PORT ?? "31415").trim();
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid AILSS_MCP_HTTP_PORT: "${portRaw}"`);
  }

  const pathRaw = (process.env.AILSS_MCP_HTTP_PATH ?? "/mcp").trim() || "/mcp";
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;

  const token = (process.env.AILSS_MCP_HTTP_TOKEN ?? process.env.AILSS_MCP_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("Missing AILSS_MCP_HTTP_TOKEN. Refusing to start without auth.");
  }

  return { host, port, path, token };
}

function baseUrlForRequest(req: IncomingMessage, config: HttpConfig): URL {
  const reqUrl = req.url ?? "/";
  return new URL(reqUrl, `http://${config.host}:${config.port}`);
}

function extractBearerToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }

  const headerToken = req.headers["x-ailss-token"];
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();

  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken.trim()) return queryToken.trim();

  return null;
}

async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", (error) => reject(error));
  });
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
): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: mcpErrorCode, message },
      id: null,
    }),
  );
}

function isInitializeRequestMessage(body: unknown): boolean {
  if (!body) return false;
  if (Array.isArray(body)) return body.some(isInitializeRequestMessage);
  if (typeof body !== "object") return false;

  const method = (body as { method?: unknown }).method;
  return method === "initialize";
}

function getSingleHeaderValue(req: IncomingMessage, name: string): string | null | "multiple" {
  const key = name.toLowerCase();

  const distinct = req.headersDistinct?.[key];
  if (Array.isArray(distinct)) {
    if (distinct.length === 1) return distinct[0] ?? null;
    if (distinct.length > 1) return "multiple";
  }

  const v = req.headers[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return "multiple";
  return null;
}

function parseMaxSessionsFromEnv(): number {
  const raw = (process.env.AILSS_MCP_HTTP_MAX_SESSIONS ?? "5").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 5;
  return n;
}

function parseIdleTtlMsFromEnv(): number {
  const raw = (process.env.AILSS_MCP_HTTP_IDLE_TTL_MS ?? "3600000").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 3_600_000;
  return n;
}

function evictOldestSessions(sessions: Map<string, McpSession>, maxSessions: number): void {
  while (sessions.size > maxSessions) {
    let oldest: McpSession | null = null;
    for (const s of sessions.values()) {
      if (!oldest) oldest = s;
      else if (s.lastSeenAtMs < oldest.lastSeenAtMs) oldest = s;
    }

    if (!oldest) return;
    sessions.delete(oldest.sessionId);
    oldest.transport.close().catch(() => {});
    oldest.server.close().catch(() => {});
  }
}

function closeIdleSessions(sessions: Map<string, McpSession>, idleTtlMs: number): void {
  if (idleTtlMs <= 0) return;
  const now = Date.now();

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastSeenAtMs <= idleTtlMs) continue;
    sessions.delete(sessionId);
    session.transport.close().catch(() => {});
    session.server.close().catch(() => {});
  }
}

async function createSession(
  runtime: AilssMcpRuntime,
  sessions: Map<string, McpSession>,
  maxSessions: number,
): Promise<{ server: McpServer; transport: StreamableHTTPServerTransport }> {
  const { server } = createAilssMcpServerFromRuntime(runtime);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      const now = Date.now();
      sessions.set(sessionId, {
        sessionId,
        server,
        transport,
        createdAtMs: now,
        lastSeenAtMs: now,
      });
      evictOldestSessions(sessions, maxSessions);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  await server.connect(transport);
  return { server, transport };
}

export async function startAilssMcpHttpServer(options: StartHttpServerOptions): Promise<{
  httpServer: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  const { config, runtime } = options;

  requireLocalhostHost(config.host);

  const sessions = new Map<string, McpSession>();
  const maxSessions = options.maxSessions ?? parseMaxSessionsFromEnv();
  const idleTtlMs = options.idleTtlMs ?? parseIdleTtlMsFromEnv();

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = baseUrlForRequest(req, config);

      if (url.pathname === "/health") {
        sendText(res, 200, "ok");
        return;
      }

      if (url.pathname !== config.path) {
        sendText(res, 404, "not found");
        return;
      }

      const token = extractBearerToken(req, url);
      if (token !== config.token) {
        sendText(res, 401, "unauthorized");
        return;
      }

      closeIdleSessions(sessions, idleTtlMs);

      let parsedBody: unknown = undefined;
      if (req.method === "POST") {
        try {
          parsedBody = await readJsonBody(req, 1_000_000);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Bad request.";
          sendText(res, 400, message);
          return;
        }
      }

      if (req.method === "POST" && isInitializeRequestMessage(parsedBody)) {
        const { server, transport } = await createSession(runtime, sessions, maxSessions);
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

      const session = sessions.get(sessionIdHeader);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }

      session.lastSeenAtMs = Date.now();
      await session.transport.handleRequest(
        req as IncomingMessage & { auth?: AuthInfo },
        res,
        parsedBody,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`[ailss-mcp-http] request error: ${message}`);
      sendText(res, 500, "internal error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: unknown) => reject(error);
    httpServer.once("error", onError);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort =
    address && typeof address === "object" && "port" in address
      ? (address.port as number)
      : config.port;
  const url = `http://${config.host}:${actualPort}${config.path}`;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await Promise.allSettled(
      Array.from(sessions.values()).flatMap((s) => [s.transport.close(), s.server.close()]),
    );
    sessions.clear();
  };

  return { httpServer, url, close };
}

export async function startAilssMcpHttpServerFromEnv(): Promise<{
  httpServer: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  const config = parseHttpConfigFromEnv();
  const runtime = await createAilssMcpRuntimeFromEnv();
  return await startAilssMcpHttpServer({ config, runtime });
}
