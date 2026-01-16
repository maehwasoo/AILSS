import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  assertRecord,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (resolve_note)", () => {
  it("resolves note paths via resolve_note", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, enableWriteTools: false },
        async ({ url, token, runtime }) => {
          const now = new Date().toISOString().slice(0, 19);

          const fileStmt = runtime.deps.db.prepare(
            "INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at) VALUES (?, ?, ?, ?, ?)",
          );
          const noteStmt = runtime.deps.db.prepare(
            "INSERT INTO notes(path, note_id, created, title, summary, entity, layer, status, updated, frontmatter_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );

          fileStmt.run("A.md", 0, 0, "0", now);
          noteStmt.run(
            "A.md",
            "20260101000000",
            "2026-01-01T00:00:00",
            "Project A",
            null,
            "project",
            "strategic",
            "draft",
            now,
            JSON.stringify({ id: "20260101000000", title: "Project A" }),
            now,
          );

          const sessionId = await mcpInitialize(url, token, "client-a");

          const byId = await mcpToolsCall(url, token, sessionId, "resolve_note", {
            query: "20260101000000",
            limit: 10,
          });

          const byIdStructured = getStructuredContent(byId);
          expect(byIdStructured["status"]).toBe("ok");
          const byIdBest = byIdStructured["best"];
          assertRecord(byIdBest, "best");
          expect(byIdBest["path"]).toBe("A.md");
          expect(byIdBest["matched_by"]).toBe("note_id");

          const byTitle = await mcpToolsCall(url, token, sessionId, "resolve_note", {
            query: "Project A",
            limit: 10,
          });

          const byTitleStructured = getStructuredContent(byTitle);
          expect(byTitleStructured["status"]).toBe("ok");
          const byTitleBest = byTitleStructured["best"];
          assertRecord(byTitleBest, "best");
          expect(byTitleBest["path"]).toBe("A.md");
          expect(byTitleBest["matched_by"]).toBe("title");
        },
      );
    });
  });
});
