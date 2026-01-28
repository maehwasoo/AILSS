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

describe("MCP HTTP server (find_broken_links)", () => {
  it("finds broken links via find_broken_links", async () => {
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

          // One valid typed link and two broken ones.
          linkStmt.run("A.md", "depends_on", "B", "[[B]]", 0, now);
          linkStmt.run("A.md", "depends_on", "Missing", "[[Missing]]", 1, now);
          linkStmt.run("A.md", "cites", "Nope", "[[Nope]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "find_broken_links", {
            path_prefix: "A",
            max_links: 100,
            max_broken: 100,
            max_resolutions_per_target: 5,
          });

          const structured = getStructuredContent(res);
          expect(structured["scanned_links"]).toBe(3);
          expect(structured["broken_total"]).toBe(2);

          const broken = structured["broken"];
          assertArray(broken, "broken");
          const targets = broken
            .map((b) => {
              assertRecord(b, "broken[i]");
              return String(b["target"] ?? "");
            })
            .sort();

          expect(targets).toEqual(["Missing", "Nope"]);
        },
      );
    });
  });
});
