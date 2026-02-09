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

describe("MCP HTTP server (neo4j_graph_traverse)", () => {
  it("falls back to SQLite traversal when Neo4j is disabled", async () => {
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
          const typedLinkStmt = runtime.deps.db.prepare(
            "INSERT INTO typed_links(from_path, rel, to_target, to_wikilink, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          );

          fileStmt.run("A.md", 0, 0, "a", now);
          fileStmt.run("B.md", 0, 0, "b", now);

          noteStmt.run(
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
          noteStmt.run(
            "B.md",
            "20260102000000",
            "2026-01-02T00:00:00",
            "B",
            null,
            null,
            null,
            null,
            now,
            JSON.stringify({ id: "20260102000000", title: "B" }),
            now,
          );

          typedLinkStmt.run("A.md", "depends_on", "B", "[[B]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-traverse");
          const response = await mcpToolsCall(url, token, sessionId, "neo4j_graph_traverse", {
            path: "A.md",
            direction: "outgoing",
            max_hops: 2,
            max_notes: 50,
            max_edges: 200,
            max_links_per_note: 20,
            include_unresolved_targets: false,
          });
          const structured = getStructuredContent(response);

          expect(structured["backend"]).toBe("sqlite_fallback");
          expect(structured["seed_path"]).toBe("A.md");
          expect(structured["truncated"]).toBe(false);

          const nodes = structured["nodes"];
          assertArray(nodes, "nodes");
          const nodePaths = nodes
            .map((node) => (node as Record<string, unknown>)["path"])
            .filter((value): value is string => typeof value === "string")
            .sort((a, b) => a.localeCompare(b));
          expect(nodePaths).toEqual(["A.md", "B.md"]);

          const edges = structured["edges"];
          assertArray(edges, "edges");
          expect(edges).toHaveLength(1);
          const first = edges[0] as Record<string, unknown>;
          expect(first["direction"]).toBe("outgoing");
          expect(first["from_path"]).toBe("A.md");
          expect(first["to_path"]).toBe("B.md");
          expect(first["rel"]).toBe("depends_on");
        },
      );
    });
  });
});
