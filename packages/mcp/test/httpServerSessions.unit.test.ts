import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpSessionStore } from "../src/httpServerSessions.js";

function createSessionMocks() {
  const transportClose = vi.fn(async () => {});
  const serverClose = vi.fn(async () => {});

  return {
    server: { close: serverClose } as unknown as McpServer,
    transport: { close: transportClose } as unknown as StreamableHTTPServerTransport,
    transportClose,
    serverClose,
  };
}

describe("McpSessionStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts the oldest session when max session cap is exceeded", () => {
    const store = new McpSessionStore(1, 60_000);
    const first = createSessionMocks();
    const second = createSessionMocks();

    store.initializeSession("session-1", first.server, first.transport, true);
    store.initializeSession("session-2", second.server, second.transport, true);

    expect(store.touchSession("session-1")).toBeUndefined();
    expect(store.touchSession("session-2")).toBeTruthy();
    expect(first.transportClose).toHaveBeenCalledTimes(1);
    expect(first.serverClose).toHaveBeenCalledTimes(1);
  });

  it("closes sessions that exceed idle ttl", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new McpSessionStore(10, 1_000);
    const active = createSessionMocks();

    store.initializeSession("session-idle", active.server, active.transport, true);
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    store.closeIdleSessions();
    expect(store.touchSession("session-idle")).toBeTruthy();

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    store.closeIdleSessions();
    expect(store.touchSession("session-idle")).toBeUndefined();
    expect(active.transportClose).toHaveBeenCalledTimes(1);
    expect(active.serverClose).toHaveBeenCalledTimes(1);
  });

  it("does not close idle sessions when idle ttl is disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new McpSessionStore(10, 0);
    const active = createSessionMocks();

    store.initializeSession("session-active", active.server, active.transport, true);
    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    store.closeIdleSessions();

    expect(store.touchSession("session-active")).toBeTruthy();
    expect(active.transportClose).not.toHaveBeenCalled();
    expect(active.serverClose).not.toHaveBeenCalled();
  });

  it("closes and clears all sessions", async () => {
    const store = new McpSessionStore(10, 60_000);
    const one = createSessionMocks();
    const two = createSessionMocks();

    store.initializeSession("session-1", one.server, one.transport, true);
    store.initializeSession("session-2", two.server, two.transport, true);
    await store.closeAllSessions();

    expect(store.touchSession("session-1")).toBeUndefined();
    expect(store.touchSession("session-2")).toBeUndefined();
    expect(one.transportClose).toHaveBeenCalledTimes(1);
    expect(one.serverClose).toHaveBeenCalledTimes(1);
    expect(two.transportClose).toHaveBeenCalledTimes(1);
    expect(two.serverClose).toHaveBeenCalledTimes(1);
  });
});
