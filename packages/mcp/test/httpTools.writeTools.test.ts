import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseMarkdownNote } from "@ailss/core";

import {
  assertString,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

describe("MCP HTTP server (write tools)", () => {
  it("creates a new note via new_note (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const relPath = "C.md";
        const absPath = path.join(vaultPath, relPath);

        const dryRun = await mcpToolsCall(url, token, sessionId, "new_note", {
          path: relPath,
          text: "hello\n",
          apply: false,
        });
        expect(getStructuredContent(dryRun)["applied"]).toBe(false);
        await expect(fs.stat(absPath)).rejects.toThrow(/ENOENT/);

        const applied = await mcpToolsCall(url, token, sessionId, "new_note", {
          path: relPath,
          text: "hello\n",
          apply: true,
          reindex_after_apply: false,
        });
        expect(getStructuredContent(applied)["applied"]).toBe(true);
        expect(getStructuredContent(applied)["created"]).toBe(true);

        const written = await fs.readFile(absPath, "utf8");
        const parsed = parseMarkdownNote(written);
        expect(typeof parsed.frontmatter.id).toBe("string");
        expect(typeof parsed.frontmatter.created).toBe("string");
        expect(parsed.frontmatter.title).toBe("C");
        expect(Array.isArray(parsed.frontmatter.tags)).toBe(true);
        expect(parsed.frontmatter.tags).not.toContain("inbox");
        expect(parsed.body).toContain("hello");

        const inboxRelPath = "100. Inbox/In.md";
        await mcpToolsCall(url, token, sessionId, "new_note", {
          path: inboxRelPath,
          text: "inbox\n",
          apply: true,
          reindex_after_apply: false,
        });
        const inboxWritten = await fs.readFile(path.join(vaultPath, inboxRelPath), "utf8");
        const inboxParsed = parseMarkdownNote(inboxWritten);
        expect(Array.isArray(inboxParsed.frontmatter.tags)).toBe(true);
        expect(inboxParsed.frontmatter.tags).toContain("inbox");
      });
    });
  });

  it("captures a note via capture_note (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const dryRun = await mcpToolsCall(url, token, sessionId, "capture_note", {
          title: "Hello Capture",
          body: "body\n",
          apply: false,
        });

        const dryStructured = getStructuredContent(dryRun);
        const dryPath = dryStructured["path"];
        assertString(dryPath, "dryRun.path");
        expect(dryPath.startsWith("100. Inbox/")).toBe(true);
        await expect(fs.stat(path.join(vaultPath, dryPath))).rejects.toThrow(/ENOENT/);

        const applied = await mcpToolsCall(url, token, sessionId, "capture_note", {
          title: "Hello Capture",
          body: "body\n",
          apply: true,
          reindex_after_apply: false,
        });

        const appliedStructured = getStructuredContent(applied);
        const appliedPath = appliedStructured["path"];
        assertString(appliedPath, "applied.path");
        expect(appliedPath.startsWith("100. Inbox/")).toBe(true);

        const written = await fs.readFile(path.join(vaultPath, appliedPath), "utf8");
        const parsed = parseMarkdownNote(written);
        expect(parsed.frontmatter.title).toBe("Hello Capture");
        expect(Array.isArray(parsed.frontmatter.tags)).toBe(true);
        expect(parsed.frontmatter.tags).toContain("inbox");
        expect(parsed.body).toContain("body");

        const other = await mcpToolsCall(url, token, sessionId, "capture_note", {
          title: "Outside Inbox",
          body: "body2\n",
          folder: "200. Projects",
          apply: true,
          reindex_after_apply: false,
        });
        const otherStructured = getStructuredContent(other);
        const otherPath = otherStructured["path"];
        assertString(otherPath, "other.path");
        expect(otherPath.startsWith("200. Projects/")).toBe(true);
        const otherWritten = await fs.readFile(path.join(vaultPath, otherPath), "utf8");
        const otherParsed = parseMarkdownNote(otherWritten);
        expect(Array.isArray(otherParsed.frontmatter.tags)).toBe(true);
        expect(otherParsed.frontmatter.tags).not.toContain("inbox");
      });
    });
  });

  it("relocates a note via relocate_note (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(path.join(vaultPath, "From.md"), "from\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const dryRun = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "From.md",
          to_path: "To.md",
          apply: false,
        });
        expect(getStructuredContent(dryRun)["applied"]).toBe(false);
        expect(await fs.readFile(path.join(vaultPath, "From.md"), "utf8")).toBe("from\n");
        await expect(fs.stat(path.join(vaultPath, "To.md"))).rejects.toThrow(/ENOENT/);

        const applied = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "From.md",
          to_path: "To.md",
          apply: true,
          reindex_after_apply: false,
        });
        expect(getStructuredContent(applied)["applied"]).toBe(true);
        expect(getStructuredContent(applied)["updated_applied"]).toBe(false);
        expect(getStructuredContent(applied)["updated_value"]).toBe(null);
        await expect(fs.stat(path.join(vaultPath, "From.md"))).rejects.toThrow(/ENOENT/);
        expect(await fs.readFile(path.join(vaultPath, "To.md"), "utf8")).toBe("from\n");

        await mcpToolsCall(url, token, sessionId, "new_note", {
          path: "WithFrontmatter.md",
          text: "x\n",
          apply: true,
          reindex_after_apply: false,
        });
        const relocated = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "WithFrontmatter.md",
          to_path: "WithFrontmatterMoved.md",
          apply: true,
          reindex_after_apply: false,
        });
        const relocatedStructured = getStructuredContent(relocated);
        expect(relocatedStructured["updated_applied"]).toBe(true);
        const updatedValue = relocatedStructured["updated_value"];
        assertString(updatedValue, "relocate_note.updated_value");
        const movedText = await fs.readFile(
          path.join(vaultPath, "WithFrontmatterMoved.md"),
          "utf8",
        );
        const movedParsed = parseMarkdownNote(movedText);
        expect(movedParsed.frontmatter.updated).toBe(updatedValue);
      });
    });
  });
});
