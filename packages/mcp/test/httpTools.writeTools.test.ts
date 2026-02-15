import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseMarkdownNote } from "@ailss/core";
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

function expectWriteReindexState(
  structured: Record<string, unknown>,
  expected: {
    applied: boolean;
    needs_reindex: boolean;
    reindexed: boolean;
    reindex_error: string | null;
  },
): void {
  expect(structured["applied"]).toBe(expected.applied);
  expect(structured["needs_reindex"]).toBe(expected.needs_reindex);
  expect(structured["reindexed"]).toBe(expected.reindexed);
  expect(structured["reindex_error"]).toBe(expected.reindex_error);
}

function getToolCallFailureMessage(payload: unknown): string {
  assertRecord(payload, "JSON-RPC payload");

  // Tool handler failures are expected to be returned as `result.isError=true`
  // (not protocol-level JSON-RPC errors).
  const result = payload["result"];
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const isError = Boolean((result as Record<string, unknown>)["isError"]);
    if (!isError) {
      throw new Error("Expected tool call to fail (result.isError=true).");
    }

    const content = (result as Record<string, unknown>)["content"];
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      assertRecord(first, "result.content[0]");
      if (first["type"] === "text") {
        const text = first["text"];
        assertString(text, "result.content[0].text");
        return text;
      }
      return JSON.stringify(first);
    }

    return "tool call failed";
  }

  const error = payload["error"];
  assertRecord(error, "JSON-RPC error");
  const message = error["message"];
  assertString(message, "JSON-RPC error.message");
  return message;
}

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
        expectWriteReindexState(dryStructured, {
          applied: false,
          needs_reindex: false,
          reindexed: false,
          reindex_error: null,
        });
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
        expectWriteReindexState(appliedStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
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
        expectWriteReindexState(otherStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
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

  it("rejects capture_note when frontmatter overrides include invalid enum values", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await withMcpHttpServer({ vaultPath, enableWriteTools: true }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");

        const invalid = await mcpToolsCall(url, token, sessionId, "capture_note", {
          title: "Invalid Status",
          body: "body\n",
          apply: false,
          frontmatter: { status: "evergreen" },
        });

        expect(getToolCallFailureMessage(invalid)).toMatch(/invalid frontmatter override/i);
        expect(getToolCallFailureMessage(invalid)).toMatch(/status/i);
        expect(getToolCallFailureMessage(invalid)).toMatch(/draft/i);
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
        expectWriteReindexState(getStructuredContent(dryRun), {
          applied: false,
          needs_reindex: false,
          reindexed: false,
          reindex_error: null,
        });
        expect(await fs.readFile(path.join(vaultPath, noteRelPath), "utf8")).toContain("hello\n");

        const applied = await mcpToolsCall(url, token, sessionId, "edit_note", {
          path: noteRelPath,
          apply: true,
          reindex_after_apply: false,
          ops: [{ op: "replace_lines", from_line: 15, to_line: 15, text: "hello world" }],
        });
        expectWriteReindexState(getStructuredContent(applied), {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
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
        expectWriteReindexState(getStructuredContent(dryRun), {
          applied: false,
          needs_reindex: false,
          reindexed: false,
          reindex_error: null,
        });
        expect(await fs.readFile(path.join(vaultPath, "From.md"), "utf8")).toBe("from\n");
        await expect(fs.stat(path.join(vaultPath, "To.md"))).rejects.toThrow(/ENOENT/);

        const applied = await mcpToolsCall(url, token, sessionId, "relocate_note", {
          from_path: "From.md",
          to_path: "To.md",
          apply: true,
          reindex_after_apply: false,
        });
        const appliedStructured = getStructuredContent(applied);
        expectWriteReindexState(appliedStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
        expect(appliedStructured["updated_applied"]).toBe(false);
        expect(appliedStructured["updated_value"]).toBe(null);
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
        expectWriteReindexState(relocatedStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
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
        expectWriteReindexState(dryStructured, {
          applied: false,
          needs_reindex: false,
          reindexed: false,
          reindex_error: null,
        });
        expect(dryStructured["changed"]).toBe(true);

        const applied = await mcpToolsCall(url, token, sessionId, "improve_frontmatter", {
          path: relPath,
          apply: true,
          reindex_after_apply: false,
        });

        const appliedStructured = getStructuredContent(applied);
        expectWriteReindexState(appliedStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
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
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "blocks")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "mitigates")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "measures")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "produces")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed.frontmatter, "owned_by")).toBe(false);
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
          "mitigates:",
          "  - Service Risk A",
          "measures:",
          "  - P95 Latency",
          "produces:",
          "  - Daily Report",
          "owned_by:",
          "  - Platform Team",
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
        expectWriteReindexState(appliedStructured, {
          applied: true,
          needs_reindex: true,
          reindexed: false,
          reindex_error: null,
        });
        expect(appliedStructured["changed"]).toBe(true);

        const written = await fs.readFile(path.join(vaultPath, relPath), "utf8");
        const parsed = parseMarkdownNote(written);

        expect(parsed.frontmatter.summarizes).toEqual(["[[Source A]]"]);
        expect(parsed.frontmatter.derived_from).toEqual(["[[Origin A]]"]);
        expect(parsed.frontmatter.verifies).toEqual(["[[Experiment A]]"]);
        expect(parsed.frontmatter.mitigates).toEqual(["[[Service Risk A]]"]);
        expect(parsed.frontmatter.measures).toEqual(["[[P95 Latency]]"]);
        expect(parsed.frontmatter.produces).toEqual(["[[Daily Report]]"]);
        expect(parsed.frontmatter.owned_by).toEqual(["[[Platform Team]]"]);
      });
    });
  });

  it("canonicalizes frontmatter typed links via canonicalize_typed_links", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      const relPath = "Source.md";
      await fs.writeFile(
        path.join(vaultPath, relPath),
        [
          "---",
          'id: "20260108123456"',
          'created: "2026-01-08T12:34:56"',
          'title: "Source"',
          "summary:",
          "aliases: []",
          "entity:",
          "layer: conceptual",
          "tags: []",
          "keywords: []",
          "status: draft",
          'updated: "2026-01-08T12:34:56"',
          "source: []",
          "depends_on:",
          '  - "[[Deterministic]]"',
          '  - "[[Duplicate]]"',
          '  - "[[Folder/Strict#H2|Strict Label]]"',
          '  - "[[Missing]]"',
          '  - "[[Nested/Note]]"',
          'uses: "[[Deterministic|Shown]]"',
          'summarizes: "Deterministic|Alias Plain"',
          "---",
          "",
          "Body should stay exactly here.",
          "",
        ].join("\n"),
        "utf8",
      );

      await withMcpHttpServer(
        {
          vaultPath,
          enableWriteTools: true,
          beforeStart: async (runtime) => {
            const now = new Date().toISOString().slice(0, 19);

            const fileStmt = runtime.deps.db.prepare(
              "INSERT INTO files(path, mtime_ms, size_bytes, sha256, updated_at) VALUES (?, ?, ?, ?, ?)",
            );
            const noteStmt = runtime.deps.db.prepare(
              "INSERT INTO notes(path, note_id, created, title, summary, entity, layer, status, updated, frontmatter_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            );

            const insertNote = (notePath: string, noteId: string, title: string): void => {
              fileStmt.run(notePath, 0, 0, "0", now);
              noteStmt.run(
                notePath,
                noteId,
                now,
                title,
                null,
                null,
                "conceptual",
                "draft",
                now,
                JSON.stringify({ id: noteId, title, tags: [] }),
                now,
              );
            };

            insertNote("Topics/Deterministic.md", "N1", "Deterministic");
            insertNote("Duplicate.md", "N2", "Duplicate");
            insertNote("Folder/Duplicate.md", "N3", "Duplicate");
            insertNote("Folder/Strict.md", "N4", "Strict");
            insertNote("X/Nested/Note.md", "N5", "Nested Note");
          },
        },
        async ({ url, token }) => {
          const sessionId = await mcpInitialize(url, token, "client-a");

          const dryRun = await mcpToolsCall(url, token, sessionId, "canonicalize_typed_links", {
            path: relPath,
            apply: false,
            reindex_after_apply: false,
          });
          const dryStructured = getStructuredContent(dryRun);

          expectWriteReindexState(dryStructured, {
            applied: false,
            needs_reindex: false,
            reindexed: false,
            reindex_error: null,
          });
          expect(dryStructured["changed"]).toBe(true);

          const editsRaw = dryStructured["edits"];
          assertArray(editsRaw, "canonicalize_typed_links.edits");
          expect(editsRaw).toHaveLength(4);

          const afterValues = editsRaw
            .map((entry) => {
              assertRecord(entry, "canonicalize_typed_links.edits[i]");
              return String(entry["after"] ?? "");
            })
            .sort();
          expect(afterValues).toEqual([
            "[[Folder/Strict|Strict Label]]",
            "[[Topics/Deterministic|Alias Plain]]",
            "[[Topics/Deterministic|Deterministic]]",
            "[[Topics/Deterministic|Shown]]",
          ]);

          const ambiguousRaw = dryStructured["ambiguous"];
          assertArray(ambiguousRaw, "canonicalize_typed_links.ambiguous");
          expect(ambiguousRaw).toHaveLength(1);
          assertRecord(ambiguousRaw[0], "canonicalize_typed_links.ambiguous[0]");
          expect(ambiguousRaw[0]["target"]).toBe("Duplicate");
          assertArray(
            ambiguousRaw[0]["candidates"],
            "canonicalize_typed_links.ambiguous[0].candidates",
          );

          const unresolvedRaw = dryStructured["unresolved"];
          assertArray(unresolvedRaw, "canonicalize_typed_links.unresolved");
          const unresolvedTargets = unresolvedRaw
            .map((entry) => {
              assertRecord(entry, "canonicalize_typed_links.unresolved[i]");
              return String(entry["target"] ?? "");
            })
            .sort();
          expect(unresolvedTargets).toEqual(["Missing", "Nested/Note"]);

          const beforeDryApply = await fs.readFile(path.join(vaultPath, relPath), "utf8");
          expect(beforeDryApply).toContain('  - "[[Deterministic]]"');
          const beforeParsed = parseMarkdownNote(beforeDryApply);

          const applied = await mcpToolsCall(url, token, sessionId, "canonicalize_typed_links", {
            path: relPath,
            apply: true,
            reindex_after_apply: false,
          });
          const appliedStructured = getStructuredContent(applied);
          expectWriteReindexState(appliedStructured, {
            applied: true,
            needs_reindex: true,
            reindexed: false,
            reindex_error: null,
          });
          expect(appliedStructured["changed"]).toBe(true);

          const written = await fs.readFile(path.join(vaultPath, relPath), "utf8");
          const parsed = parseMarkdownNote(written);

          expect(parsed.body).toBe(beforeParsed.body);
          expect(parsed.frontmatter.depends_on).toEqual([
            "[[Topics/Deterministic|Deterministic]]",
            "[[Duplicate]]",
            "[[Folder/Strict|Strict Label]]",
            "[[Missing]]",
            "[[Nested/Note]]",
          ]);
          expect(parsed.frontmatter.uses).toBe("[[Topics/Deterministic|Shown]]");
          expect(parsed.frontmatter.summarizes).toBe("[[Topics/Deterministic|Alias Plain]]");
        },
      );
    });
  });
});
