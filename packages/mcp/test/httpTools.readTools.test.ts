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

          linkStmt.run("A.md", "see_also", "B", "[[B]]", 0, now);

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

  it("filters notes via search_notes and lists tag/keyword facets", async () => {
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
          const keywordStmt = runtime.deps.db.prepare(
            "INSERT INTO note_keywords(path, keyword) VALUES (?, ?) ON CONFLICT(path, keyword) DO NOTHING",
          );
          const sourceStmt = runtime.deps.db.prepare(
            "INSERT INTO note_sources(path, source) VALUES (?, ?) ON CONFLICT(path, source) DO NOTHING",
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
          keywordStmt.run("A.md", "llm");
          sourceStmt.run("A.md", "https://example.com/a");

          const sessionId = await mcpInitialize(url, token, "client-a");

          const searchRes = await mcpToolsCall(url, token, sessionId, "search_notes", {
            tags_any: ["project"],
            limit: 10,
          });
          const searchStructured = getStructuredContent(searchRes);
          const results = searchStructured["results"];
          assertArray(results, "results");
          expect(results.map((r) => (r as Record<string, unknown>)["path"])).toEqual(["A.md"]);

          const tagRes = await mcpToolsCall(url, token, sessionId, "list_tags", { limit: 10 });
          const tagStructured = getStructuredContent(tagRes);
          const tags = tagStructured["tags"];
          assertArray(tags, "tags");
          expect(tags.map((t) => (t as Record<string, unknown>)["tag"]).sort()).toEqual([
            "project",
            "reference",
          ]);

          const kwRes = await mcpToolsCall(url, token, sessionId, "list_keywords", { limit: 10 });
          const kwStructured = getStructuredContent(kwRes);
          const keywords = kwStructured["keywords"];
          assertArray(keywords, "keywords");
          expect(keywords.map((k) => (k as Record<string, unknown>)["keyword"])).toEqual(["llm"]);
        },
      );
    });
  });

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
          fileStmt.run("WorldAce.md", 0, 0, "0", now);

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
            "WorldAce.md",
            "WorldAce",
            now,
            "WorldAce",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "WorldAce", title: "WorldAce", tags: [] }),
            now,
          );

          linkStmt.run("A.md", "part_of", "WorldAce", "[[WorldAce]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "find_typed_link_backrefs", {
            rel: "part_of",
            to_target: "WorldAce",
            limit: 10,
          });

          const structured = getStructuredContent(res);
          const backrefs = structured["backrefs"];
          assertArray(backrefs, "backrefs");
          expect(backrefs).toHaveLength(1);
          assertRecord(backrefs[0], "backrefs[0]");
          expect(backrefs[0]["from_path"]).toBe("A.md");
          expect(backrefs[0]["to_target"]).toBe("WorldAce");
        },
      );
    });
  });

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

          // One valid link and two broken ones.
          linkStmt.run("A.md", "links_to", "B", "[[B]]", 0, now);
          linkStmt.run("A.md", "links_to", "Missing", "[[Missing]]", 1, now);
          linkStmt.run("A.md", "depends_on", "Nope", "[[Nope]]", 0, now);

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
          expect(suggestions.length).toBe(2);

          const s0 = suggestions[0];
          const s1 = suggestions[1];
          assertRecord(s0, "suggestions[0]");
          assertRecord(s1, "suggestions[1]");

          expect(s0["rel"]).toBe("uses");
          expect(s0["target"]).toBe("Tool");
          expect(String(s0["suggested_wikilink"])).toBe("[[Tool|Tool Title]]");

          expect(s1["rel"]).toBe("see_also");
          expect(s1["target"]).toBe("Concept");
          expect(String(s1["suggested_wikilink"])).toBe("[[Concept]]");
        },
      );
    });
  });
});
