import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assertRecord,
  assertString,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

function getToolCallFailureMessage(payload: unknown): string {
  assertRecord(payload, "JSON-RPC payload");

  // Tool handler failures are expected to be returned as `result.isError=true`
  // (not protocol-level JSON-RPC errors).
  const result = payload["result"];
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const isError = Boolean((result as Record<string, unknown>)["isError"]);
    if (!isError) {
      throw new Error("Expected tool call to fail (result.isError=true).");
    }

    const content = (result as Record<string, unknown>)["content"];
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      assertRecord(first, "result.content[0]");
      if (first["type"] === "text") {
        const text = first["text"];
        assertString(text, "result.content[0].text");
        return text;
      }
      return JSON.stringify(first);
    }

    return "tool call failed";
  }

  const error = payload["error"];
  assertRecord(error, "JSON-RPC error");
  const message = error["message"];
  assertString(message, "JSON-RPC error.message");
  return message;
}

describe("MCP HTTP server (path traversal + invalid paths)", () => {
  it("rejects read_note paths outside the vault (../ and absolute)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "ok\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const traversal = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "../Doc.md",
          max_chars: 1000,
        });
        expect(getToolCallFailureMessage(traversal)).toMatch(/outside the vault/i);

        const outsideAbs = path.resolve(vaultPath, "..", "Outside.md");
        const absolute = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: outsideAbs,
          max_chars: 1000,
        });
        expect(getToolCallFailureMessage(absolute)).toMatch(/outside the vault/i);
      });
    });
  });

  it("rejects edit_note with non-markdown paths and path traversal", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Edit.md"), "a\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const nonMarkdown = await mcpToolsCall(url, token, sessionId, "edit_note", {
          path: "Edit.txt",
          apply: false,
          ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "x" }],
        });
        expect(getToolCallFailureMessage(nonMarkdown)).toMatch(/non-markdown/i);

        const traversal = await mcpToolsCall(url, token, sessionId, "edit_note", {
          path: "../Edit.md",
          apply: false,
          ops: [{ op: "replace_lines", from_line: 1, to_line: 1, text: "x" }],
        });
        expect(getToolCallFailureMessage(traversal)).toMatch(/outside the vault/i);
      });
    });
  });

  it("rejects relocate_note with non-markdown paths and path traversal", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "From.md"), "from\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const nonMarkdown = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "From.txt",
          to_path: "To.md",
          apply: false,
        });
        expect(getToolCallFailureMessage(nonMarkdown)).toMatch(/non-markdown/i);

        const traversal = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "../From.md",
          to_path: "To.md",
          apply: false,
        });
        expect(getToolCallFailureMessage(traversal)).toMatch(/outside the vault/i);
      });
    });
  });

  it("rejects capture_note when folder escapes the vault (dry-run)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const res = await mcpToolsCall(url, token, sessionId, "capture_note", {
          title: "Escape Attempt",
          body: "body\n",
          folder: "../Escape",
          apply: false,
        });

        expect(getToolCallFailureMessage(res)).toMatch(/outside the vault/i);
      });
    });
  });
});
