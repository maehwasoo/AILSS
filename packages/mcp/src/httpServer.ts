// AILSS MCP server - Streamable HTTP server (localhost)
// - intended to be hosted by the Obsidian plugin and consumed by Codex via URL + token

import http from "node:http";

import { createAilssMcpRuntimeFromEnv } from "./createAilssMcpServer.js";
import {
  normalizeShutdownConfig,
  parseHttpConfigFromEnv,
  parseIdleTtlMsFromEnv,
  parseMaxSessionsFromEnv,
  requireLocalhostHost,
  type StartHttpServerOptions,
} from "./httpServerConfig.js";
import { createHttpRequestHandler } from "./httpServerRoutes.js";
import { McpSessionStore } from "./httpServerSessions.js";

export type { HttpConfig, StartHttpServerOptions } from "./httpServerConfig.js";
export { parseHttpConfigFromEnv, requireLocalhostHost } from "./httpServerConfig.js";

export async function startAilssMcpHttpServer(options: StartHttpServerOptions): Promise<{
  httpServer: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  const { config, runtime } = options;

  requireLocalhostHost(config.host);

  const maxSessions = options.maxSessions ?? parseMaxSessionsFromEnv();
  const idleTtlMs = options.idleTtlMs ?? parseIdleTtlMsFromEnv();
  const shutdown = normalizeShutdownConfig(options.shutdown);
  const sessionStore = new McpSessionStore(maxSessions, idleTtlMs);

  let shuttingDown = false;
  let closePromise: Promise<void> | null = null;

  const startShuttingDown = (): void => {
    shuttingDown = true;
  };

  const requestHandler = createHttpRequestHandler({
    config,
    runtime,
    sessionStore,
    shutdown,
    isShuttingDown: () => shuttingDown,
    startShuttingDown,
    close,
  });

  const httpServer = http.createServer(async (req, res) => {
    await requestHandler(req, res);
  });

  async function close(): Promise<void> {
    if (closePromise) return await closePromise;

    startShuttingDown();
    closePromise = (async () => {
      const closeServer = new Promise<void>((resolve, reject) => {
        const onError = (error: unknown) => reject(error);
        httpServer.once("error", onError);
        httpServer.close(() => {
          httpServer.off("error", onError);
          resolve();
        });
      });

      const sessionClose = sessionStore.closeAllSessions();

      // Close keep-alive sockets so the port is actually released.
      httpServer.closeIdleConnections();

      // If a streaming/SSE connection is still active, close it forcefully to guarantee shutdown.
      const forceCloseTimeout = setTimeout(() => {
        httpServer.closeAllConnections();
        httpServer.closeIdleConnections();
      }, 2_000);
      forceCloseTimeout.unref?.();

      try {
        // Don't let shutdown hang indefinitely if a transport refuses to close.
        await Promise.race([
          sessionClose.then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);

        // Some connections become idle only after transports close.
        httpServer.closeIdleConnections();
        await closeServer;
      } finally {
        clearTimeout(forceCloseTimeout);
      }
    })();

    return await closePromise;
  }

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

  return { httpServer, url, close };
}

export async function startAilssMcpHttpServerFromEnv(): Promise<{
  httpServer: http.Server;
  url: string;
  close: () => Promise<void>;
}> {
  const config = parseHttpConfigFromEnv();
  const runtime = await createAilssMcpRuntimeFromEnv();
  const shutdownToken = (process.env.AILSS_MCP_HTTP_SHUTDOWN_TOKEN ?? "").trim();
  const options: StartHttpServerOptions = {
    config,
    runtime,
    ...(shutdownToken ? { shutdown: { token: shutdownToken, exitProcess: true } } : {}),
  };
  return await startAilssMcpHttpServer(options);
}
