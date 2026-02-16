import type { AilssMcpRuntime } from "./createAilssMcpServer.js";

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
  enableJsonResponse?: boolean;
  shutdown?: {
    path?: string;
    token: string;
    exitProcess?: boolean;
  };
};

export type ShutdownConfig = {
  path: string;
  token: string;
  exitProcess: boolean;
};

const DEFAULT_SHUTDOWN_PATH = "/__ailss/shutdown";

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

export function parseMaxSessionsFromEnv(): number {
  const raw = (process.env.AILSS_MCP_HTTP_MAX_SESSIONS ?? "100").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 100;
  return n;
}

export function parseIdleTtlMsFromEnv(): number {
  const raw = (process.env.AILSS_MCP_HTTP_IDLE_TTL_MS ?? "0").trim();
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function parseEnableJsonResponseFromEnv(): boolean {
  const rawValue = (process.env.AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE ?? "1").trim();
  const raw = rawValue.toLowerCase();
  if (!raw) return true;

  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;

  throw new Error(
    `Invalid AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE: "${rawValue}". Expected 0/1/true/false/on/off/yes/no.`,
  );
}

export function normalizeShutdownConfig(
  shutdown: StartHttpServerOptions["shutdown"] | undefined,
): ShutdownConfig | null {
  if (!shutdown) return null;

  const token = shutdown.token.trim();
  if (!token) return null;

  const rawPath = shutdown.path ?? DEFAULT_SHUTDOWN_PATH;
  return {
    path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
    token,
    exitProcess: shutdown.exitProcess ?? false,
  };
}
