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

describe("MCP HTTP server (find_typed_link_backrefs)", () => {
  it("returns typed link backrefs via find_typed_link_backrefs", async () => {
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
          fileStmt.run("SRETeam.md", 0, 0, "0", now);

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
            "SRETeam.md",
            "SRETeam",
            now,
            "SRE Team",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "SRETeam", title: "SRE Team", tags: [] }),
            now,
          );

          linkStmt.run("A.md", "owned_by", "SRE Team", "[[SRE Team]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "find_typed_link_backrefs", {
            rel: "owned_by",
            to_target: "SRE Team",
            limit: 10,
          });

          const structured = getStructuredContent(res);
          const backrefs = structured["backrefs"];
          assertArray(backrefs, "backrefs");
          expect(backrefs).toHaveLength(1);
          assertRecord(backrefs[0], "backrefs[0]");
          expect(backrefs[0]["from_path"]).toBe("A.md");
          expect(backrefs[0]["rel"]).toBe("owned_by");
          expect(backrefs[0]["to_target"]).toBe("SRE Team");
        },
      );
    });
  });
});
