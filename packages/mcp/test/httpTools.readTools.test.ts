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
  it("searches the vault via search_vault", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "Doc.md"), "a\nneedle\nb\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "search_vault", {
          query: "needle",
          regex: false,
          case_sensitive: true,
          max_results: 10,
          max_matches_per_file: 10,
        });

        const structured = getStructuredContent(res);
        const results = structured["results"];
        assertArray(results, "results");
        expect(results.length).toBe(1);
        assertRecord(results[0], "results[0]");
        expect(results[0]["path"]).toBe("Doc.md");
        const matches = results[0]["matches"];
        assertArray(matches, "matches");
        expect(matches.length).toBe(1);
        assertRecord(matches[0], "matches[0]");
        expect(matches[0]["line"]).toBe(2);
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

  it("returns a typed-link graph via get_vault_graph (and get_note_graph alias)", async () => {
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
          const res = await mcpToolsCall(url, token, sessionId, "get_vault_graph", {
            seed_paths: ["A.md"],
            max_hops: 1,
            max_nodes: 10,
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
          expect(edges[0]["from_path"]).toBe("A.md");
          expect(edges[0]["to_target"]).toBe("B");

          const toPaths = edges[0]["to_paths"];
          assertArray(toPaths, "edges[0].to_paths");
          expect(toPaths.map((t) => (t as Record<string, unknown>)["path"])).toContain("B.md");

          const noteGraph = await mcpToolsCall(url, token, sessionId, "get_note_graph", {
            path: "A.md",
            max_hops: 1,
            max_nodes: 10,
            max_edges: 10,
            max_resolutions_per_target: 5,
          });

          const noteStructured = getStructuredContent(noteGraph);
          const noteNodes = noteStructured["nodes"];
          assertArray(noteNodes, "get_note_graph.nodes");
          expect(noteNodes.map((n) => (n as Record<string, unknown>)["path"]).sort()).toEqual([
            "A.md",
            "B.md",
          ]);
        },
      );
    });
  });
});
