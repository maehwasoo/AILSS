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

describe("MCP HTTP server (list_typed_link_rels)", () => {
  it("lists rel counts and canonical classification", async () => {
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

          linkStmt.run("A.md", "part_of", "WorldAce", "[[WorldAce]]", 0, now);
          linkStmt.run("A.md", "links_to", "Legacy Hub", "[[Legacy Hub]]", 1, now);
          linkStmt.run("B.md", "part_of", "WorldAce", "[[WorldAce]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "list_typed_link_rels", {
            limit: 10,
            order_by: "count_desc",
          });

          const structured = getStructuredContent(res);
          const query = structured["query"];
          assertRecord(query, "query");
          expect(query["path_prefix"]).toBeNull();
          expect(query["order_by"]).toBe("count_desc");

          const rels = structured["rels"];
          assertArray(rels, "rels");
          expect(rels).toHaveLength(2);
          assertRecord(rels[0], "rels[0]");
          assertRecord(rels[1], "rels[1]");
          expect(rels[0]["rel"]).toBe("part_of");
          expect(rels[0]["count"]).toBe(2);
          expect(rels[0]["canonical"]).toBe(true);
          expect(rels[1]["rel"]).toBe("links_to");
          expect(rels[1]["count"]).toBe(1);
          expect(rels[1]["canonical"]).toBe(false);
        },
      );
    });
  });

  it("treats path_prefix as a literal prefix (escapes _ and %)", async () => {
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

          const paths = ["20_Areas/A.md", "20XAreas/B.md", "20%Areas/C.md"];
          for (const p of paths) {
            fileStmt.run(p, 0, 0, "0", now);
            noteStmt.run(
              p,
              p,
              now,
              p,
              null,
              null,
              "conceptual",
              "draft",
              now,
              JSON.stringify({ id: p, title: p, tags: [] }),
              now,
            );
          }

          linkStmt.run("20_Areas/A.md", "part_of", "WorldAce", "[[WorldAce]]", 0, now);
          linkStmt.run("20XAreas/B.md", "links_to", "Legacy Hub", "[[Legacy Hub]]", 0, now);
          linkStmt.run("20%Areas/C.md", "cites", "Spec", "[[Spec]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");

          const underscoreRes = await mcpToolsCall(url, token, sessionId, "list_typed_link_rels", {
            path_prefix: "20_Areas/",
            order_by: "count_desc",
          });
          const underscoreStructured = getStructuredContent(underscoreRes);
          const underscoreRels = underscoreStructured["rels"];
          assertArray(underscoreRels, "rels");
          expect(underscoreRels).toHaveLength(1);
          assertRecord(underscoreRels[0], "rels[0]");
          expect(underscoreRels[0]["rel"]).toBe("part_of");
          expect(underscoreRels[0]["count"]).toBe(1);

          const percentRes = await mcpToolsCall(url, token, sessionId, "list_typed_link_rels", {
            path_prefix: "20%Areas/",
            order_by: "count_desc",
          });
          const percentStructured = getStructuredContent(percentRes);
          const percentRels = percentStructured["rels"];
          assertArray(percentRels, "rels");
          expect(percentRels).toHaveLength(1);
          assertRecord(percentRels[0], "rels[0]");
          expect(percentRels[0]["rel"]).toBe("cites");
          expect(percentRels[0]["count"]).toBe(1);
        },
      );
    });
  });
});
