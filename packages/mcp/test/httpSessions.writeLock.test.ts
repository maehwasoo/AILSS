import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";

import { mcpInitialize, mcpToolsCall, withMcpHttpServer, withTempDir } from "./httpTestUtils.js";

describe("MCP HTTP server (write tools)", () => {
  it("serializes write tools across sessions (writeLock)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "A.md"), "a\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "B.md"), "b\n", "utf8");

      let entered1Resolve: (() => void) | undefined;
      const entered1 = new Promise<void>((resolve) => {
        entered1Resolve = resolve;
      });

      let attempted2Resolve: (() => void) | undefined;
      const attempted2 = new Promise<void>((resolve) => {
        attempted2Resolve = resolve;
      });

      let releaseHoldResolve: (() => void) | undefined;
      const releaseHold = new Promise<void>((resolve) => {
        releaseHoldResolve = resolve;
      });

      const events: Array<{ type: "attempt" | "enter" | "exit"; callId: number; at: number }> = [];
      let callSeq = 0;

      const beforeStart = async (runtime: AilssMcpRuntime) => {
        const underlyingLock = runtime.deps.writeLock;
        expect(underlyingLock).toBeTruthy();

        runtime.deps.writeLock = {
          runExclusive: async <T>(fn: () => Promise<T>): Promise<T> => {
            const callId = (callSeq += 1);
            events.push({ type: "attempt", callId, at: Date.now() });
            if (callId === 2) attempted2Resolve?.();

            return await underlyingLock!.runExclusive(async () => {
              events.push({ type: "enter", callId, at: Date.now() });
              if (callId === 1) {
                entered1Resolve?.();
                await releaseHold;
              }

              try {
                return await fn();
              } finally {
                events.push({ type: "exit", callId, at: Date.now() });
              }
            });
          },
        };
      };

      await withMcpHttpServer(
        { vaultPath, enableWriteTools: true, maxSessions: 5, idleTtlMs: 60_000, beforeStart },
        async ({ url, token }) => {
          const s1 = await mcpInitialize(url, token, "client-a");
          const s2 = await mcpInitialize(url, token, "client-b");

          const call1 = mcpToolsCall(url, token, s1, "edit_note", {
            path: "A.md",
            apply: true,
            reindex_after_apply: false,
            ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "a1" }],
          });

          await entered1;

          const call2 = mcpToolsCall(url, token, s2, "edit_note", {
            path: "B.md",
            apply: true,
            reindex_after_apply: false,
            ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "b1" }],
          });

          await attempted2;
          releaseHoldResolve?.();

          await Promise.all([call1, call2]);

          const enter1 = events.find((e) => e.type === "enter" && e.callId === 1);
          const exit1 = events.find((e) => e.type === "exit" && e.callId === 1);
          const enter2 = events.find((e) => e.type === "enter" && e.callId === 2);
          const attempt2 = events.find((e) => e.type === "attempt" && e.callId === 2);
          const exit1Index = events.findIndex((e) => e.type === "exit" && e.callId === 1);
          const enter2Index = events.findIndex((e) => e.type === "enter" && e.callId === 2);
          const attempt2Index = events.findIndex((e) => e.type === "attempt" && e.callId === 2);

          expect(enter1).toBeTruthy();
          expect(exit1).toBeTruthy();
          expect(enter2).toBeTruthy();
          expect(attempt2).toBeTruthy();

          expect(attempt2Index).toBeGreaterThanOrEqual(0);
          expect(exit1Index).toBeGreaterThanOrEqual(0);
          expect(enter2Index).toBeGreaterThanOrEqual(0);

          expect(attempt2Index).toBeLessThan(exit1Index);
          expect(enter2Index).toBeGreaterThan(exit1Index);
        },
      );
    });
  });
});
