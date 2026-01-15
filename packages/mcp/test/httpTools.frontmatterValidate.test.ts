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

describe("MCP HTTP server (frontmatter_validate)", () => {
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
        expect(issues).toHaveLength(1);
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
        expect(issues).toHaveLength(1);
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("MissingSource.md");
        expect(issues[0]["has_frontmatter"]).toBe(true);

        const missing = issues[0]["missing_keys"];
        assertArray(missing, "issues[0].missing_keys");
        expect(missing).toContain("source");
      });
    });
  });
});
