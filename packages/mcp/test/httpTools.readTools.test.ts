import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assertArray,
  assertRecord,
  assertString,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (read tools)", () => {
  it("reads a note via read_note", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "a\nb\nc\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "read_note", {
          path: "Doc.md",
          max_chars: 20_000,
        });

        const structured = getStructuredContent(res);
        expect(structured["path"]).toBe("Doc.md");
        expect(structured["truncated"]).toBe(false);
        expect(String(structured["content"])).toBe("a\nb\nc\n");
      });
    });
  });

  it("returns a vault tree via get_vault_tree", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.mkdir(path.join(vaultPath, "A/B"), { recursive: true });
      await fs.writeFile(path.join(vaultPath, "A/B/C.md"), "c\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "Root.md"), "root\n", "utf8");

      await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
      await fs.writeFile(path.join(vaultPath, ".obsidian/Hidden.md"), "nope\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const foldersOnly = await mcpToolsCall(url, token, sessionId, "get_vault_tree", {
          include_files: false,
          max_depth: 10,
          max_nodes: 1000,
        });

        const foldersStructured = getStructuredContent(foldersOnly);
        expect(foldersStructured["file_count"]).toBe(0);
        const folders = foldersStructured["folders"];
        assertArray(folders, "foldersOnly.folders");
        expect(folders).toContain("A");
        expect(folders).toContain("A/B");

        const treeOnly = foldersStructured["tree"];
        assertString(treeOnly, "foldersOnly.tree");
        expect(treeOnly).toContain("A");
        expect(treeOnly).not.toContain(".obsidian");

        const withFiles = await mcpToolsCall(url, token, sessionId, "get_vault_tree", {
          include_files: true,
          max_depth: 10,
          max_nodes: 1000,
        });

        const withFilesStructured = getStructuredContent(withFiles);
        const files = withFilesStructured["files"];
        assertArray(files, "withFiles.files");
        expect(files).toContain("A/B/C.md");
        expect(files).toContain("Root.md");
        expect(files).not.toContain(".obsidian/Hidden.md");
      });
    });
  });

  it("validates frontmatter via frontmatter_validate", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "Ok.md"),
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "Ok"',
          "summary:",
          "aliases: []",
          "entity:",
          "layer: conceptual",
          "tags: []",
          "keywords: []",
          "status: draft",
          'updated: "2026-01-08T12:34:56"',
          "source: []",
          "---",
          "",
          "ok",
          "",
        ].join("\n"),
        "utf8",
      );
      await fs.writeFile(path.join(vaultPath, "NoFrontmatter.md"), "nope\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(2);
        expect(structured["ok_count"]).toBe(1);
        expect(structured["issue_count"]).toBe(1);

        const issues = structured["issues"];
        assertArray(issues, "issues");
        expect(issues.length).toBe(1);
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("NoFrontmatter.md");
        expect(issues[0]["has_frontmatter"]).toBe(false);
      });
    });
  });

  it("flags frontmatter that is missing the source key", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "MissingSource.md"),
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "MissingSource"',
          "summary:",
          "aliases: []",
          "entity:",
          "layer: conceptual",
          "tags: []",
          "keywords: []",
          "status: draft",
          'updated: "2026-01-08T12:34:56"',
          "---",
          "",
          "missing source",
          "",
        ].join("\n"),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(1);
        expect(structured["ok_count"]).toBe(0);
        expect(structured["issue_count"]).toBe(1);

        const issues = structured["issues"];
        assertArray(issues, "issues");
        expect(issues.length).toBe(1);
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("MissingSource.md");
        expect(issues[0]["has_frontmatter"]).toBe(true);

        const missing = issues[0]["missing_keys"];
        assertArray(missing, "issues[0].missing_keys");
        expect(missing).toContain("source");
      });
    });
  });

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
            "INSERT INTO notes(path, note_id, created, title, summary, entity, layer, status, updated, viewed, frontmatter_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            0,
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
            0,
            JSON.stringify({ id: "B", title: "B", tags: [] }),
            now,
          );

          linkStmt.run("A.md", "see_also", "B", "[[B]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "get_typed_links", {
            path: "A.md",
            max_hops: 1,
            include_outgoing: true,
            include_incoming: false,
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
