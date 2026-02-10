import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeShutdownConfig,
  parseHttpConfigFromEnv,
  parseIdleTtlMsFromEnv,
  parseMaxSessionsFromEnv,
  requireLocalhostHost,
} from "../src/httpServerConfig.js";

type HttpEnvKey =
  | "AILSS_MCP_HTTP_HOST"
  | "AILSS_MCP_HTTP_PORT"
  | "AILSS_MCP_HTTP_PATH"
  | "AILSS_MCP_HTTP_TOKEN"
  | "AILSS_MCP_TOKEN"
  | "AILSS_MCP_HTTP_MAX_SESSIONS"
  | "AILSS_MCP_HTTP_IDLE_TTL_MS";

const HTTP_ENV_KEYS: HttpEnvKey[] = [
  "AILSS_MCP_HTTP_HOST",
  "AILSS_MCP_HTTP_PORT",
  "AILSS_MCP_HTTP_PATH",
  "AILSS_MCP_HTTP_TOKEN",
  "AILSS_MCP_TOKEN",
  "AILSS_MCP_HTTP_MAX_SESSIONS",
  "AILSS_MCP_HTTP_IDLE_TTL_MS",
];

const originalEnv: Partial<Record<HttpEnvKey, string | undefined>> = {};
for (const key of HTTP_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of HTTP_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("httpServerConfig helpers", () => {
  it("accepts localhost hosts and rejects non-localhost hosts", () => {
    expect(() => requireLocalhostHost("127.0.0.1")).not.toThrow();
    expect(() => requireLocalhostHost("localhost")).not.toThrow();
    expect(() => requireLocalhostHost("::1")).not.toThrow();
    expect(() => requireLocalhostHost("0.0.0.0")).toThrow(
      'Refusing to bind MCP HTTP server to non-localhost host: "0.0.0.0"',
    );
  });

  it("parses env config with defaults", () => {
    delete process.env.AILSS_MCP_HTTP_HOST;
    delete process.env.AILSS_MCP_HTTP_PORT;
    delete process.env.AILSS_MCP_HTTP_PATH;
    process.env.AILSS_MCP_HTTP_TOKEN = "token-a";
    delete process.env.AILSS_MCP_TOKEN;

    expect(parseHttpConfigFromEnv()).toEqual({
      host: "127.0.0.1",
      port: 31415,
      path: "/mcp",
      token: "token-a",
    });
  });

  it("normalizes path and falls back to AILSS_MCP_TOKEN", () => {
    process.env.AILSS_MCP_HTTP_HOST = "localhost";
    process.env.AILSS_MCP_HTTP_PORT = "8080";
    process.env.AILSS_MCP_HTTP_PATH = "custom";
    delete process.env.AILSS_MCP_HTTP_TOKEN;
    process.env.AILSS_MCP_TOKEN = "fallback-token";

    expect(parseHttpConfigFromEnv()).toEqual({
      host: "localhost",
      port: 8080,
      path: "/custom",
      token: "fallback-token",
    });
  });

  it("throws on invalid port and missing token", () => {
    process.env.AILSS_MCP_HTTP_HOST = "127.0.0.1";
    process.env.AILSS_MCP_HTTP_PORT = "70000";
    process.env.AILSS_MCP_HTTP_TOKEN = "token";
    expect(() => parseHttpConfigFromEnv()).toThrow('Invalid AILSS_MCP_HTTP_PORT: "70000"');

    process.env.AILSS_MCP_HTTP_PORT = "31415";
    process.env.AILSS_MCP_HTTP_TOKEN = "";
    process.env.AILSS_MCP_TOKEN = "";
    expect(() => parseHttpConfigFromEnv()).toThrow(
      "Missing AILSS_MCP_HTTP_TOKEN. Refusing to start without auth.",
    );
  });

  it("parses max sessions and idle ttl with safe defaults", () => {
    delete process.env.AILSS_MCP_HTTP_MAX_SESSIONS;
    delete process.env.AILSS_MCP_HTTP_IDLE_TTL_MS;
    expect(parseMaxSessionsFromEnv()).toBe(50);
    expect(parseIdleTtlMsFromEnv()).toBe(3_600_000);

    process.env.AILSS_MCP_HTTP_MAX_SESSIONS = "abc";
    process.env.AILSS_MCP_HTTP_IDLE_TTL_MS = "-1";
    expect(parseMaxSessionsFromEnv()).toBe(50);
    expect(parseIdleTtlMsFromEnv()).toBe(3_600_000);

    process.env.AILSS_MCP_HTTP_MAX_SESSIONS = "12";
    process.env.AILSS_MCP_HTTP_IDLE_TTL_MS = "2500";
    expect(parseMaxSessionsFromEnv()).toBe(12);
    expect(parseIdleTtlMsFromEnv()).toBe(2500);
  });

  it("normalizes shutdown config", () => {
    expect(normalizeShutdownConfig(undefined)).toBeNull();
    expect(normalizeShutdownConfig({ token: "   " })).toBeNull();
    expect(normalizeShutdownConfig({ token: "x" })).toEqual({
      path: "/__ailss/shutdown",
      token: "x",
      exitProcess: false,
    });
    expect(normalizeShutdownConfig({ path: "bye", token: " t ", exitProcess: true })).toEqual({
      path: "/bye",
      token: "t",
      exitProcess: true,
    });
  });
});
