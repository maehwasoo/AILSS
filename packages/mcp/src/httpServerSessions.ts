import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createAilssMcpServerFromRuntime, type AilssMcpRuntime } from "./createAilssMcpServer.js";

export type McpSession = {
  sessionId: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAtMs: number;
  lastSeenAtMs: number;
};

export class McpSessionStore {
  readonly #sessions = new Map<string, McpSession>();
  readonly #maxSessions: number;
  readonly #idleTtlMs: number;

  constructor(maxSessions: number, idleTtlMs: number) {
    this.#maxSessions = maxSessions;
    this.#idleTtlMs = idleTtlMs;
  }

  initializeSession(
    sessionId: string,
    server: McpServer,
    transport: StreamableHTTPServerTransport,
  ): void {
    const now = Date.now();
    this.#sessions.set(sessionId, {
      sessionId,
      server,
      transport,
      createdAtMs: now,
      lastSeenAtMs: now,
    });
    this.#evictOldestSessions();
  }

  closeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
  }

  touchSession(sessionId: string): McpSession | undefined {
    const session = this.#sessions.get(sessionId);
    if (!session) return undefined;
    session.lastSeenAtMs = Date.now();
    return session;
  }

  closeIdleSessions(): void {
    if (this.#idleTtlMs <= 0) return;
    const now = Date.now();

    for (const [sessionId, session] of this.#sessions.entries()) {
      if (now - session.lastSeenAtMs <= this.#idleTtlMs) continue;
      this.#sessions.delete(sessionId);
      session.transport.close().catch(() => {});
      session.server.close().catch(() => {});
    }
  }

  async closeAllSessions(): Promise<void> {
    const sessionClose = Promise.allSettled(
      Array.from(this.#sessions.values()).flatMap((session) => [
        session.transport.close(),
        session.server.close(),
      ]),
    );
    this.#sessions.clear();
    await sessionClose;
  }

  #evictOldestSessions(): void {
    while (this.#sessions.size > this.#maxSessions) {
      let oldest: McpSession | null = null;
      for (const session of this.#sessions.values()) {
        if (!oldest) oldest = session;
        else if (session.lastSeenAtMs < oldest.lastSeenAtMs) oldest = session;
      }

      if (!oldest) return;
      this.#sessions.delete(oldest.sessionId);
      oldest.transport.close().catch(() => {});
      oldest.server.close().catch(() => {});
    }
  }
}

export async function createSession(
  runtime: AilssMcpRuntime,
  sessionStore: McpSessionStore,
): Promise<{ server: McpServer; transport: StreamableHTTPServerTransport }> {
  const { server } = createAilssMcpServerFromRuntime(runtime);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessionStore.initializeSession(sessionId, server, transport);
    },
    onsessionclosed: (sessionId) => {
      sessionStore.closeSession(sessionId);
    },
  });

  await server.connect(transport);
  return { server, transport };
}
