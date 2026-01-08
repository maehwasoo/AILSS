#!/usr/bin/env node
// AILSS MCP server - Streamable HTTP transport (localhost)
// - Intended to be hosted by the Obsidian plugin and consumed by Codex via URL + token.

import http, { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { createAilssMcpServer } from "./createAilssMcpServer.js";

type HttpConfig = {
  host: string;
  port: number;
  path: string;
  token: string;
};

function requireLocalhostHost(host: string): void {
  if (host === "127.0.0.1") return;
  if (host === "localhost") return;
  if (host === "::1") return;
  throw new Error(`Refusing to bind MCP HTTP server to non-localhost host: "${host}"`);
}

function parseHttpConfigFromEnv(): HttpConfig {
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

async function main(): Promise<void> {
  const config = parseHttpConfigFromEnv();

  const { server: mcpServer } = await createAilssMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await mcpServer.connect(transport);

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

      await transport.handleRequest(req as IncomingMessage & { auth?: AuthInfo }, res, parsedBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ailss-mcp-http] request error: ${message}`);
      sendText(res, 500, "internal error");
    }
  });

  httpServer.listen(config.port, config.host, () => {
    console.log(`[ailss-mcp-http] listening on http://${config.host}:${config.port}${config.path}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[ailss-mcp-http] shutdown requested (${signal})`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
