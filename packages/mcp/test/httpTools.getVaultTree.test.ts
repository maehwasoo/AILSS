import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assertArray,
  assertString,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (get_vault_tree)", () => {
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
});
