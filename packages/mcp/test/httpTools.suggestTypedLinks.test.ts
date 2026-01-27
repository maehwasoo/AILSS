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

describe("MCP HTTP server (suggest_typed_links)", () => {
  it("suggests typed links via suggest_typed_links", async () => {
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
          fileStmt.run("Tool.md", 0, 0, "0", now);
          fileStmt.run("Concept.md", 0, 0, "0", now);

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
            "Tool.md",
            "Tool",
            now,
            "Tool Title",
            null,
            "tool",
            "physical",
            "draft",
            now,
            JSON.stringify({ id: "Tool", title: "Tool Title", entity: "tool", tags: [] }),
            now,
          );
          noteStmt.run(
            "Concept.md",
            "Concept",
            now,
            "Concept",
            null,
            "concept",
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "Concept", title: "Concept", entity: "concept", tags: [] }),
            now,
          );

          // Body wikilinks are indexed as rel=links_to edges.
          linkStmt.run("A.md", "links_to", "Tool", "[[Tool]]", 0, now);
          linkStmt.run("A.md", "links_to", "Concept", "[[Concept]]", 1, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "suggest_typed_links", {
            path: "A.md",
            max_links_to_consider: 10,
            max_suggestions: 10,
            max_resolutions_per_target: 5,
          });

          const structured = getStructuredContent(res);
          expect(structured["seed_path"]).toBe("A.md");

          const suggestions = structured["suggestions"];
          assertArray(suggestions, "suggestions");
          expect(suggestions.length).toBe(1);

          const s0 = suggestions[0];
          assertRecord(s0, "suggestions[0]");

          expect(s0["rel"]).toBe("uses");
          expect(s0["target"]).toBe("Tool");
          expect(String(s0["suggested_wikilink"])).toBe("[[Tool|Tool Title]]");
        },
      );
    });
  });
});
