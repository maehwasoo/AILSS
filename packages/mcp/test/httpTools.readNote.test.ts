import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (read_note)", () => {
  it("reads a note via read_note", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "a\nb\nc\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Doc.md",
          max_chars: 20_000,
        });

        const structured = getStructuredContent(res);
        expect(structured["path"]).toBe("Doc.md");
        expect(structured["start_index"]).toBe(0);
        expect(structured["truncated"]).toBe(false);
        expect(structured["next_start_index"]).toBe(null);
        expect(String(structured["content"])).toBe("a\nb\nc\n");
      });
    });
  });

  it("paginates a note via read_note (start_index)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const fullText = "x".repeat(350);
      await fs.writeFile(path.join(vaultPath, "Doc.md"), fullText, "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const first = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Doc.md",
          start_index: 0,
          max_chars: 200,
        });
        const firstStructured = getStructuredContent(first);
        expect(firstStructured["path"]).toBe("Doc.md");
        expect(firstStructured["start_index"]).toBe(0);
        expect(firstStructured["max_chars"]).toBe(200);
        expect(firstStructured["truncated"]).toBe(true);
        expect(firstStructured["next_start_index"]).toBe(200);

        const second = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Doc.md",
          start_index: 200,
          max_chars: 200,
        });
        const secondStructured = getStructuredContent(second);
        expect(secondStructured["path"]).toBe("Doc.md");
        expect(secondStructured["start_index"]).toBe(200);
        expect(secondStructured["max_chars"]).toBe(200);
        expect(secondStructured["truncated"]).toBe(false);
        expect(secondStructured["next_start_index"]).toBe(null);

        const combined = String(firstStructured["content"]) + String(secondStructured["content"]);
        expect(combined).toBe(fullText);
      });
    });
  });

  it("returns empty content via read_note when start_index is past EOF", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "abc", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Doc.md",
          start_index: 999,
          max_chars: 200,
        });

        const structured = getStructuredContent(res);
        expect(structured["path"]).toBe("Doc.md");
        expect(structured["start_index"]).toBe(999);
        expect(structured["max_chars"]).toBe(200);
        expect(structured["truncated"]).toBe(false);
        expect(structured["next_start_index"]).toBe(null);
        expect(structured["content"]).toBe("");
      });
    });
  });
});
