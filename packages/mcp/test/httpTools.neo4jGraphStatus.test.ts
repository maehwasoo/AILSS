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

describe("MCP HTTP server (neo4j_graph_status)", () => {
  it("returns fallback status and SQLite graph counts when Neo4j is disabled", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      await withMcpHttpServer(
        { dbPath, enableWriteTools: false },
        async ({ url, token, runtime }) => {
          const now = new Date().toISOString().slice(0, 19);

          runtime.deps.db
            .prepare(
              "INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run("A.md", 0, 0, "0", now);

          runtime.deps.db
            .prepare(
              "INSERT INTO notes(path, note_id, created, title, summary, entity, layer, status, updated, frontmatter_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              "A.md",
              "20260101000000",
              "2026-01-01T00:00:00",
              "A",
              null,
              null,
              null,
              null,
              now,
              JSON.stringify({ id: "20260101000000", title: "A" }),
              now,
            );

          runtime.deps.db
            .prepare(
              "INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run("A.md", "depends_on", "B", "[[B]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-status");
          const response = await mcpToolsCall(url, token, sessionId, "neo4j_graph_status", {});
          const structured = getStructuredContent(response);

          expect(structured["enabled"]).toBe(false);
          expect(structured["configured"]).toBe(false);
          expect(structured["available"]).toBe(false);
          expect(structured["neo4j_counts"]).toBeNull();
          expect(structured["consistent"]).toBeNull();
          expect(structured["active_run_id"]).toBeNull();
          expect(structured["mirror_status"]).toBe("empty");
          expect(structured["last_success_at"]).toBeNull();

          const sqliteCounts = structured["sqlite_counts"];
          assertRecord(sqliteCounts, "sqlite_counts");
          expect(sqliteCounts["notes"]).toBe(1);
          expect(sqliteCounts["typed_links"]).toBe(1);
        },
      );
    });
  });
});
