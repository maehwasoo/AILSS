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

describe("MCP HTTP server (search_notes)", () => {
  it("filters notes via search_notes", async () => {
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
          const tagStmt = runtime.deps.db.prepare(
            "INSERT INTO note_tags(path, tag) VALUES (?, ?) ON CONFLICT(path, tag) DO NOTHING",
          );

          fileStmt.run("A.md", 0, 0, "0", now);
          fileStmt.run("B.md", 0, 0, "0", now);

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
          noteStmt.run(
            "B.md",
            "20260102000000",
            "2026-01-02T00:00:00",
            "Concept B",
            null,
            "concept",
            "conceptual",
            "active",
            now,
            JSON.stringify({ id: "20260102000000", title: "Concept B", tags: ["reference"] }),
            now,
          );

          tagStmt.run("A.md", "project");
          tagStmt.run("B.md", "reference");

          const sessionId = await mcpInitialize(url, token, "client-a");

          const searchRes = await mcpToolsCall(url, token, sessionId, "search_notes", {
            tags_any: ["project"],
            limit: 10,
          });
          const searchStructured = getStructuredContent(searchRes);
          const results = searchStructured["results"];
          assertArray(results, "results");
          expect(results.map((r) => (r as Record<string, unknown>)["path"])).toEqual(["A.md"]);
        },
      );
    });
  });
});
