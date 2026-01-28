import { describe, expect, it } from "vitest";

import path from "node:path";

import {
  assertArray,
  assertRecord,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (get_typed_links)", () => {
  it("returns typed links via get_typed_links", async () => {
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
          const linkStmt = runtime.deps.db.prepare(
            "INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          );

          fileStmt.run("A.md", 0, 0, "0", now);
          fileStmt.run("B.md", 0, 0, "0", now);

          noteStmt.run(
            "A.md",
            "A",
            now,
            "A",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "A", title: "A", tags: [] }),
            now,
          );
          noteStmt.run(
            "B.md",
            "B",
            now,
            "B",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "B", title: "B", tags: [] }),
            now,
          );

          linkStmt.run("A.md", "cites", "B", "[[B]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "get_typed_links", {
            path: "A.md",
            max_notes: 10,
            max_edges: 10,
            max_resolutions_per_target: 5,
          });

          const structured = getStructuredContent(res);

          const nodes = structured["nodes"];
          assertArray(nodes, "nodes");
          expect(nodes.map((n) => (n as Record<string, unknown>)["path"]).sort()).toEqual([
            "A.md",
            "B.md",
          ]);

          const edges = structured["edges"];
          assertArray(edges, "edges");
          expect(edges.length).toBe(1);
          assertRecord(edges[0], "edges[0]");
          expect(edges[0]["direction"]).toBe("outgoing");
          expect(edges[0]["from_path"]).toBe("A.md");
          expect(edges[0]["to_path"]).toBe("B.md");
        },
      );
    });
  });
});
