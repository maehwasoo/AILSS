import { describe, expect, it } from "vitest";

import path from "node:path";
import http from "node:http";
import net from "node:net";

import { withMcpHttpServer, withTempDir } from "./httpTestUtils.js";

describe("MCP HTTP server (shutdown endpoint)", () => {
  it("is disabled unless explicitly enabled", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath }, async ({ url, token }) => {
        const u = new URL(url);
        u.pathname = "/__ailss/shutdown";
        u.search = "";

        const res = await fetch(u.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("not found");

        u.pathname = "/health";
        const health = await fetch(u.toString());
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");
      });
    });
  });

  it("rejects unauthenticated shutdown requests", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, shutdownToken: "shutdown-token" }, async ({ url }) => {
        const u = new URL(url);
        u.pathname = "/__ailss/shutdown";
        u.search = "";

        const res = await fetch(u.toString(), { method: "POST" });
        expect(res.status).toBe(401);
        expect(await res.text()).toBe("unauthorized");

        u.pathname = "/health";
        const health = await fetch(u.toString());
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");
      });
    });
  });

  it("rejects shutdown requests using the regular MCP token", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, token: "mcp-token", shutdownToken: "shutdown-token" },
        async ({ url, token }) => {
          const u = new URL(url);
          u.pathname = "/__ailss/shutdown";
          u.search = "";

          const res = await fetch(u.toString(), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          expect(res.status).toBe(401);
          expect(await res.text()).toBe("unauthorized");
        },
      );
    });
  });

  it("shuts down when authenticated and frees the port", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, shutdownToken: "shutdown-token" }, async ({ url }) => {
        const u = new URL(url);
        const host = u.hostname;
        const port = Number.parseInt(u.port, 10);
        expect(Number.isFinite(port)).toBe(true);

        u.pathname = "/__ailss/shutdown";
        u.search = "";
        const shutdown = await fetch(u.toString(), {
          method: "POST",
          headers: { Authorization: "Bearer shutdown-token" },
        });
        expect(shutdown.status).toBe(200);
        expect(await shutdown.text()).toBe("shutting down");

        await expect(waitForTcpPortToBeAvailable({ host, port, timeoutMs: 2_000 })).resolves.toBe(
          true,
        );
      });
    });
  });

  it("shuts down even with keep-alive connections (port is released)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, shutdownToken: "shutdown-token" }, async ({ url }) => {
        const u = new URL(url);
        const host = u.hostname;
        const port = Number.parseInt(u.port, 10);
        expect(Number.isFinite(port)).toBe(true);

        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        try {
          await requestKeepAliveHealthCheck({ host, port, agent });

          u.pathname = "/__ailss/shutdown";
          u.search = "";
          const shutdown = await fetch(u.toString(), {
            method: "POST",
            headers: { Authorization: "Bearer shutdown-token" },
          });
          expect(shutdown.status).toBe(200);
          expect(await shutdown.text()).toBe("shutting down");

          await expect(waitForTcpPortToBeAvailable({ host, port, timeoutMs: 5_000 })).resolves.toBe(
            true,
          );
        } finally {
          agent.destroy();
        }
      });
    });
  });
});

function requestKeepAliveHealthCheck(options: {
  host: string;
  port: number;
  agent: http.Agent;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: options.host,
        port: options.port,
        path: "/health",
        method: "GET",
        agent: options.agent,
        headers: {
          Connection: "keep-alive",
        },
      },
      (res) => {
        res.once("error", reject);
        res.resume();
        res.once("end", () => resolve());
      },
    );

    req.once("error", reject);
    req.end();
  });
}

async function waitForTcpPortToBeAvailable(options: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, options.timeoutMs);

  while (Date.now() < deadline) {
    const available = await canListenTcpPort({ host: options.host, port: options.port });
    if (available) return true;
    await sleep(50);
  }

  return canListenTcpPort({ host: options.host, port: options.port });
}

function canListenTcpPort(options: { host: string; port: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen(options.port, options.host, () => {
      server.close(() => resolve(true));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
