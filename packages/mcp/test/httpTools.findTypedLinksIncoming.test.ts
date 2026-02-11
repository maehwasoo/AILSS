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

describe("MCP HTTP server (find_typed_links_incoming)", () => {
  it("returns typed link backrefs via find_typed_links_incoming", async () => {
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
          const res = await mcpToolsCall(url, token, sessionId, "find_typed_links_incoming", {
            rel: "owned_by",
            to_target: "SRE Team",
            limit: 10,
          });

          const structured = getStructuredContent(res);
          const query = structured["query"];
          assertRecord(query, "query");
          expect(query["canonical_only"]).toBe(true);
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

  it("filters out non-canonical rels by default and allows opt-out", async () => {
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

          fileStmt.run("Legacy.md", 0, 0, "0", now);
          noteStmt.run(
            "Legacy.md",
            "Legacy",
            now,
            "Legacy",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "Legacy", title: "Legacy", tags: [] }),
            now,
          );
          linkStmt.run("Legacy.md", "links_to", "Legacy Hub", "[[Legacy Hub]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-b");

          const defaultRes = await mcpToolsCall(
            url,
            token,
            sessionId,
            "find_typed_links_incoming",
            {
              rel: "links_to",
              to_target: "Legacy Hub",
              limit: 10,
            },
          );
          const defaultStructured = getStructuredContent(defaultRes);
          const defaultBackrefs = defaultStructured["backrefs"];
          assertArray(defaultBackrefs, "backrefs");
          expect(defaultBackrefs).toHaveLength(0);

          const legacyRes = await mcpToolsCall(url, token, sessionId, "find_typed_links_incoming", {
            rel: "links_to",
            to_target: "Legacy Hub",
            limit: 10,
            canonical_only: false,
          });
          const legacyStructured = getStructuredContent(legacyRes);
          const query = legacyStructured["query"];
          assertRecord(query, "query");
          expect(query["canonical_only"]).toBe(false);
          const legacyBackrefs = legacyStructured["backrefs"];
          assertArray(legacyBackrefs, "backrefs");
          expect(legacyBackrefs).toHaveLength(1);
          assertRecord(legacyBackrefs[0], "backrefs[0]");
          expect(legacyBackrefs[0]["rel"]).toBe("links_to");
          expect(legacyBackrefs[0]["to_target"]).toBe("Legacy Hub");
        },
      );
    });
  });
});
