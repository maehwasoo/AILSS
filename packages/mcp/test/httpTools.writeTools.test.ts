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

  it("records a thinking session via sequentialthinking (dry-run + apply)", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const dryRun = await mcpToolsCall(url, token, sessionId, "sequentialthinking", {
          thought: "step 1",
          nextThoughtNeeded: true,
          thoughtNumber: 1,
          totalThoughts: 2,
          apply: false,
        });

        const dryStructured = getStructuredContent(dryRun);
        const drySessionPath = dryStructured["session_path"];
        assertString(drySessionPath, "dryRun.session_path");
        const dryThoughtPath = dryStructured["thought_path"];
        assertString(dryThoughtPath, "dryRun.thought_path");
        await expect(fs.stat(path.join(vaultPath, drySessionPath))).rejects.toThrow(/ENOENT/);
        await expect(fs.stat(path.join(vaultPath, dryThoughtPath))).rejects.toThrow(/ENOENT/);

        const applied1 = await mcpToolsCall(url, token, sessionId, "sequentialthinking", {
          thought: "step 1",
          nextThoughtNeeded: true,
          thoughtNumber: 1,
          totalThoughts: 2,
          apply: true,
          reindex_after_apply: false,
        });

        const applied1Structured = getStructuredContent(applied1);
        const sessionPath = applied1Structured["session_path"];
        assertString(sessionPath, "applied1.session_path");
        const sessionTitle = applied1Structured["session_title"];
        assertString(sessionTitle, "applied1.session_title");
        const thought1Path = applied1Structured["thought_path"];
        assertString(thought1Path, "applied1.thought_path");
        const thought1Title = applied1Structured["thought_title"];
        assertString(thought1Title, "applied1.thought_title");
        expect(sessionPath.startsWith("100. Inbox/")).toBe(true);
        expect(thought1Path.startsWith("100. Inbox/")).toBe(true);

        const sessionText1 = await fs.readFile(path.join(vaultPath, sessionPath), "utf8");
        const sessionParsed1 = parseMarkdownNote(sessionText1);
        const sessionSeeAlso1 = sessionParsed1.frontmatter.see_also;
        expect(Array.isArray(sessionSeeAlso1)).toBe(true);
        expect(
          (sessionSeeAlso1 as unknown[]).some(
            (v) => typeof v === "string" && v.includes(thought1Title),
          ),
        ).toBe(true);

        const thoughtText1 = await fs.readFile(path.join(vaultPath, thought1Path), "utf8");
        const thoughtParsed1 = parseMarkdownNote(thoughtText1);
        const thoughtPartOf1 = thoughtParsed1.frontmatter.part_of;
        expect(Array.isArray(thoughtPartOf1)).toBe(true);
        expect(
          (thoughtPartOf1 as unknown[]).some(
            (v) => typeof v === "string" && v.includes(sessionTitle),
          ),
        ).toBe(true);
        expect(thoughtParsed1.frontmatter.depends_on).toEqual([]);

        const applied2 = await mcpToolsCall(url, token, sessionId, "sequentialthinking", {
          session_path: sessionPath,
          thought: "step 2",
          nextThoughtNeeded: false,
          thoughtNumber: 2,
          totalThoughts: 2,
          apply: true,
          reindex_after_apply: false,
        });

        const applied2Structured = getStructuredContent(applied2);
        const thought2Path = applied2Structured["thought_path"];
        assertString(thought2Path, "applied2.thought_path");
        const thought2Title = applied2Structured["thought_title"];
        assertString(thought2Title, "applied2.thought_title");
        const thoughtText2 = await fs.readFile(path.join(vaultPath, thought2Path), "utf8");
        const thoughtParsed2 = parseMarkdownNote(thoughtText2);
        const thoughtDepends2 = thoughtParsed2.frontmatter.depends_on;
        expect(Array.isArray(thoughtDepends2)).toBe(true);
        expect(
          (thoughtDepends2 as unknown[]).some(
            (v) => typeof v === "string" && v.includes(thought1Title),
          ),
        ).toBe(true);

        const sessionText2 = await fs.readFile(path.join(vaultPath, sessionPath), "utf8");
        const sessionParsed2 = parseMarkdownNote(sessionText2);
        const sessionSeeAlso2 = sessionParsed2.frontmatter.see_also;
        expect(Array.isArray(sessionSeeAlso2)).toBe(true);
        expect(
          (sessionSeeAlso2 as unknown[]).some(
            (v) => typeof v === "string" && v.includes(thought2Title),
          ),
        ).toBe(true);
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

        // Typed-link keys should always exist as arrays.
        expect(Array.isArray(parsed.frontmatter.instance_of)).toBe(true);
        expect(Array.isArray(parsed.frontmatter.part_of)).toBe(true);
        expect(Array.isArray(parsed.frontmatter.uses)).toBe(true);
      });
    });
  });
});
