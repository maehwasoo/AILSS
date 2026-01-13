import { describe, expect, it } from "vitest";

import path from "node:path";
import net from "node:net";

import { withMcpHttpServer, withTempDir } from "./httpTestUtils.js";

describe("MCP HTTP server (shutdown endpoint)", () => {
  it("rejects unauthenticated shutdown requests", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath }, async ({ url }) => {
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

  it("shuts down when authenticated and frees the port", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath }, async ({ url, token }) => {
        const u = new URL(url);
        const host = u.hostname;
        const port = Number.parseInt(u.port, 10);
        expect(Number.isFinite(port)).toBe(true);

        u.pathname = "/__ailss/shutdown";
        u.search = "";
        const shutdown = await fetch(u.toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(shutdown.status).toBe(200);
        expect(await shutdown.text()).toBe("shutting down");

        await expect(waitForTcpPortToBeAvailable({ host, port, timeoutMs: 2_000 })).resolves.toBe(
          true,
        );
      });
    });
  });
});

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
