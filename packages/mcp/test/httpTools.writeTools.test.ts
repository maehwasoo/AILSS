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
        expect(parsed.frontmatter.summary).toBe(null);
        expect(parsed.frontmatter.entity).toBe(null);
        expect(parsed.frontmatter.layer).toBe(null);
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

  it("edits a note via edit_note (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const noteRelPath = "Edit.md";
      await fs.writeFile(
        path.join(vaultPath, noteRelPath),
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "Edit"',
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
          "hello",
          "",
        ].join("\n"),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const dryRun = await mcpToolsCall(url, token, sessionId, "edit_note", {
          path: noteRelPath,
          apply: false,
          ops: [{ op: "replace_lines", from_line: 15, to_line: 15, text: "hello world" }],
        });
        expect(getStructuredContent(dryRun)["applied"]).toBe(false);
        expect(await fs.readFile(path.join(vaultPath, noteRelPath), "utf8")).toContain("hello\n");

        const applied = await mcpToolsCall(url, token, sessionId, "edit_note", {
          path: noteRelPath,
          apply: true,
          reindex_after_apply: false,
          ops: [{ op: "replace_lines", from_line: 15, to_line: 15, text: "hello world" }],
        });
        expect(getStructuredContent(applied)["applied"]).toBe(true);
        expect(await fs.readFile(path.join(vaultPath, noteRelPath), "utf8")).toContain(
          "hello world\n",
        );
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

        await fs.writeFile(
          path.join(vaultPath, "WithFrontmatter.md"),
          [
            "---",
            'id: "20260108123456"',
            'created: "2026-01-08T12:34:56"',
            'title: "WithFrontmatter"',
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
            "x",
            "",
          ].join("\n"),
          "utf8",
        );
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

  it("improves frontmatter via improve_frontmatter (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const relPath = "NoFrontmatter.md";
      await fs.writeFile(path.join(vaultPath, relPath), "# NoFrontmatter\n\nbody\n", "utf8");

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const dryRun = await mcpToolsCall(url, token, sessionId, "improve_frontmatter", {
          path: relPath,
          apply: false,
          reindex_after_apply: false,
        });

        const dryStructured = getStructuredContent(dryRun);
        expect(dryStructured["applied"]).toBe(false);
        expect(dryStructured["changed"]).toBe(true);

        const applied = await mcpToolsCall(url, token, sessionId, "improve_frontmatter", {
          path: relPath,
          apply: true,
          reindex_after_apply: false,
        });

        const appliedStructured = getStructuredContent(applied);
        expect(appliedStructured["applied"]).toBe(true);
        expect(appliedStructured["changed"]).toBe(true);

        const written = await fs.readFile(path.join(vaultPath, relPath), "utf8");
        const parsed = parseMarkdownNote(written);

        expect(String(parsed.frontmatter.title)).toBe("NoFrontmatter");
        expect(typeof parsed.frontmatter.id).toBe("string");
        expect(typeof parsed.frontmatter.created).toBe("string");
        expect(typeof parsed.frontmatter.updated).toBe("string");
        expect(Array.isArray(parsed.frontmatter.tags)).toBe(true);

        // Typed-link keys should only exist when used.
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "instance_of")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "part_of")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "uses")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "summarizes")).toBe(false);
      });
    });
  });

  it("normalizes extended typed-link values via improve_frontmatter", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const relPath = "TypedLinks.md";
      await fs.writeFile(
        path.join(vaultPath, relPath),
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "TypedLinks"',
          "summary:",
          "aliases: []",
          "entity:",
          "layer:",
          "tags: []",
          "keywords: []",
          "status: draft",
          'updated: "2026-01-08T12:34:56"',
          "source: []",
          "summarizes: Source A",
          "derived_from:",
          '  - "[[Origin A]]"',
          "verifies:",
          "  - Experiment A",
          "---",
          "",
          "body",
          "",
        ].join("\n"),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const applied = await mcpToolsCall(url, token, sessionId, "improve_frontmatter", {
          path: relPath,
          apply: true,
          reindex_after_apply: false,
        });

        const appliedStructured = getStructuredContent(applied);
        expect(appliedStructured["applied"]).toBe(true);
        expect(appliedStructured["changed"]).toBe(true);

        const written = await fs.readFile(path.join(vaultPath, relPath), "utf8");
        const parsed = parseMarkdownNote(written);

        expect(parsed.frontmatter.summarizes).toEqual(["[[Source A]]"]);
        expect(parsed.frontmatter.derived_from).toEqual(["[[Origin A]]"]);
        expect(parsed.frontmatter.verifies).toEqual(["[[Experiment A]]"]);
      });
    });
  });
});
