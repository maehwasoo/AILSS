import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assertArray,
  assertRecord,
  assertString,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

function expectToolCallErrorResult(payload: unknown): void {
  assertRecord(payload, "JSON-RPC payload");
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  expect(result["isError"]).toBe(true);
}

function getToolCallFailureMessage(payload: unknown): string {
  assertRecord(payload, "JSON-RPC payload");
  const result = payload["result"];
  assertRecord(result, "JSON-RPC result");
  expect(result["isError"]).toBe(true);

  const content = result["content"];
  assertArray(content, "JSON-RPC result.content");
  assertRecord(content[0], "JSON-RPC result.content[0]");
  expect(content[0]["type"]).toBe("text");
  const text = content[0]["text"];
  assertString(text, "JSON-RPC result.content[0].text");
  return text;
}

describe("MCP HTTP server (tool failure diagnostics)", () => {
  it("stores failed tool calls and summarizes them via get_tool_failure_report", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const failed = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Missing/Doc.md",
          max_chars: 5_000,
        });
        expectToolCallErrorResult(failed);

        const reportPayload = await mcpToolsCall(url, token, sessionId, "get_tool_failure_report", {
          recent_limit: 10,
          top_error_limit: 5,
        });

        const structured = getStructuredContent(reportPayload);
        expect(structured["enabled"]).toBe(true);
        expect(structured["log_dir"]).toBe(path.join(vaultPath, ".ailss", "logs"));
        expect(structured["log_path"]).toBe(
          path.join(vaultPath, ".ailss", "logs", "mcp-tool-failures.jsonl"),
        );
        expect(structured["matched_events"]).toBe(1);
        expect(structured["scanned_events"]).toBe(1);

        const topErrorTypes = structured["top_error_types"];
        assertArray(topErrorTypes, "top_error_types");
        expect(topErrorTypes.length).toBe(1);
        assertRecord(topErrorTypes[0], "top_error_types[0]");
        expect(topErrorTypes[0]["tool"]).toBe("read_note");
        expect(topErrorTypes[0]["error_code"]).toBe("ENOENT");

        const recentEvents = structured["recent_events"];
        assertArray(recentEvents, "recent_events");
        expect(recentEvents.length).toBe(1);
        assertRecord(recentEvents[0], "recent_events[0]");
        expect(recentEvents[0]["tool"]).toBe("read_note");
        expect(recentEvents[0]["operation"]).toBe("tool_call");
        expect(recentEvents[0]["input_path"]).toBe("Missing/Doc.md");
        expect(recentEvents[0]["resolved_path"]).toBe(path.join(vaultPath, "Missing", "Doc.md"));

        const error = recentEvents[0]["error"];
        assertRecord(error, "recent_events[0].error");
        expect(error["code"]).toBe("ENOENT");
        expect(typeof error["message"]).toBe("string");

        const logPath = path.join(vaultPath, ".ailss", "logs", "mcp-tool-failures.jsonl");
        const logText = await fs.readFile(logPath, "utf8");
        const rows = logText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        expect(rows.length).toBe(1);

        const logged = JSON.parse(rows[0] ?? "{}") as Record<string, unknown>;
        expect(logged["tool"]).toBe("read_note");
        expect(logged["input_path"]).toBe("Missing/Doc.md");
      });
    });
  });

  it("returns disabled report state without AILSS_VAULT_PATH", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer({ dbPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const reportPayload = await mcpToolsCall(url, token, sessionId, "get_tool_failure_report", {
          recent_limit: 10,
          top_error_limit: 5,
        });

        const structured = getStructuredContent(reportPayload);
        expect(structured["enabled"]).toBe(false);
        expect(structured["log_dir"]).toBe(null);
        expect(structured["log_path"]).toBe(null);
        expect(structured["scanned_events"]).toBe(0);
        expect(structured["matched_events"]).toBe(0);

        const recentEvents = structured["recent_events"];
        assertArray(recentEvents, "recent_events");
        expect(recentEvents.length).toBe(0);
      });
    });
  });

  it("returns disabled report when diagnostics dependency is not wired", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer(
        {
          vaultPath,
          enableWriteTools: false,
          beforeStart: (runtime) => {
            delete runtime.deps.toolFailureDiagnostics;
          },
        },
        async ({ url, token }) => {
          const sessionId = await mcpInitialize(url, token, "client-a");
          const reportPayload = await mcpToolsCall(
            url,
            token,
            sessionId,
            "get_tool_failure_report",
            {
              recent_limit: 10,
              top_error_limit: 5,
            },
          );

          const structured = getStructuredContent(reportPayload);
          expect(structured["enabled"]).toBe(false);
          expect(structured["log_dir"]).toBe(null);
          expect(structured["log_path"]).toBe(null);
          expect(structured["scanned_events"]).toBe(0);
          expect(structured["matched_events"]).toBe(0);

          const recentEvents = structured["recent_events"];
          assertArray(recentEvents, "recent_events");
          expect(recentEvents.length).toBe(0);
        },
      );
    });
  });

  it("preserves original tool failure when diagnostics logger throws", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer(
        {
          vaultPath,
          enableWriteTools: false,
          beforeStart: (runtime) => {
            const diagnostics = runtime.deps.toolFailureDiagnostics;
            if (!diagnostics) return;
            runtime.deps.toolFailureDiagnostics = {
              ...diagnostics,
              logToolFailure: async () => {
                throw new Error("diagnostics failed");
              },
            };
          },
        },
        async ({ url, token }) => {
          const sessionId = await mcpInitialize(url, token, "client-a");
          const failed = await mcpToolsCall(url, token, sessionId, "read_note", {
            path: "Missing/Doc.md",
            max_chars: 1_000,
          });

          const message = getToolCallFailureMessage(failed);
          expect(message).toContain("ENOENT");
          expect(message).not.toContain("diagnostics failed");
        },
      );
    });
  });
});
