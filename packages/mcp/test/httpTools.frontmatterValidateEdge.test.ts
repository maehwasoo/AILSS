import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
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

const OK_FRONTMATTER = [
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
].join("\n");

describe("MCP HTTP server (frontmatter_validate edge cases)", () => {
  it("flags id/created mismatch even when required keys exist", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const mismatch = [
        "---",
        'id: "20260108123457"',
        'created: "2026-01-08T12:34:56"',
        'title: "Mismatch"',
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
        "x",
        "",
      ].join("\n");
      await fs.writeFile(path.join(vaultPath, "Mismatch.md"), mismatch, "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["ok_count"]).toBe(0);
        expect(structured["issue_count"]).toBe(1);

        const issues = structured["issues"];
        assertArray(issues, "issues");
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("Mismatch.md");
        expect(issues[0]["missing_keys"]).toEqual([]);
        expect(issues[0]["id_format_ok"]).toBe(true);
        expect(issues[0]["created_format_ok"]).toBe(true);
        expect(issues[0]["id_matches_created"]).toBe(false);
      });
    });
  });

  it("flags invalid YAML frontmatter blocks as parsed_frontmatter=false", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const badYaml = [
        "---",
        "title Hello",
        "aliases:",
        "  - [[Bad YAML]]",
        "---",
        "",
        "# Body",
        "",
      ].join("\n");
      await fs.writeFile(path.join(vaultPath, "BadYaml.md"), badYaml, "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["ok_count"]).toBe(0);
        expect(structured["issue_count"]).toBe(1);

        const issues = structured["issues"];
        assertArray(issues, "issues");
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("BadYaml.md");
        expect(issues[0]["has_frontmatter"]).toBe(true);
        expect(issues[0]["parsed_frontmatter"]).toBe(false);

        const missing = issues[0]["missing_keys"];
        assertArray(missing, "issues[0].missing_keys");
        expect(missing).toContain("id");
        expect(missing).toContain("title");
      });
    });
  });

  it("respects max_files and sets truncated=true when stopping early", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "A.md"), OK_FRONTMATTER + "a\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "B.md"), "nope\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {
          max_files: 1,
        });

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(1);
        expect(structured["truncated"]).toBe(true);
        expect(structured["ok_count"]).toBe(1);
        expect(structured["issue_count"]).toBe(0);
      });
    });
  });

  it("filters by path_prefix", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.mkdir(path.join(vaultPath, "Folder"), { recursive: true });
      await fs.writeFile(path.join(vaultPath, "Folder", "Only.md"), OK_FRONTMATTER + "x\n", "utf8");
      await fs.writeFile(path.join(vaultPath, "Root.md"), "nope\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {
          path_prefix: "Folder/",
        });

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(1);
        expect(structured["ok_count"]).toBe(1);
        expect(structured["issue_count"]).toBe(0);
      });
    });
  });
});
