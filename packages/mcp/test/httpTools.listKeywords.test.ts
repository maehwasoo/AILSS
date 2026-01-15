import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  assertArray,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (list_keywords)", () => {
  it("lists keyword facets via list_keywords", async () => {
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
          const keywordStmt = runtime.deps.db.prepare(
            "INSERT INTO note_keywords(path, keyword) VALUES (?, ?) ON CONFLICT(path, keyword) DO NOTHING",
          );

          fileStmt.run("A.md", 0, 0, "0", now);

          noteStmt.run(
            "A.md",
            "20260101000000",
            "2026-01-01T00:00:00",
            "Project A",
            "A summary",
            "project",
            "strategic",
            "draft",
            now,
            JSON.stringify({ id: "20260101000000", title: "Project A", tags: ["project"] }),
            now,
          );

          keywordStmt.run("A.md", "llm");

          const sessionId = await mcpInitialize(url, token, "client-a");
          const kwRes = await mcpToolsCall(url, token, sessionId, "list_keywords", { limit: 10 });
          const kwStructured = getStructuredContent(kwRes);
          const keywords = kwStructured["keywords"];
          assertArray(keywords, "keywords");
          expect(keywords.map((k) => (k as Record<string, unknown>)["keyword"])).toEqual(["llm"]);
        },
      );
    });
  });
});
