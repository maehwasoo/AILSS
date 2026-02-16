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

function noteWithFrontmatter(options: {
  id: string;
  created: string;
  title: string;
  entity?: string;
  layer?: string;
  status?: string;
  typedLinks?: string[];
  body?: string;
}): string {
  const lines = [
    "---",
    `id: "${options.id}"`,
    `created: "${options.created}"`,
    `title: "${options.title}"`,
    "summary:",
    "aliases: []",
    `entity: ${options.entity ?? "concept"}`,
    `layer: ${options.layer ?? "conceptual"}`,
    "tags: []",
    "keywords: []",
    `status: ${options.status ?? "draft"}`,
    `updated: "${options.created}"`,
    "source: []",
  ];

  if (options.typedLinks && options.typedLinks.length > 0) {
    lines.push(...options.typedLinks);
  }

  lines.push("---", "", options.body ?? "body", "");
  return lines.join("\n");
}

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

  it("flags invalid enum values for status/layer/entity", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "BadEnums.md"),
        noteWithFrontmatter({
          id: "20260108123456",
          created: "2026-01-08T12:34:56",
          title: "Bad Enums",
          entity: "unicorn",
          layer: "cosmos",
          status: "evergreen",
        }),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["ok_count"]).toBe(0);
        expect(structured["issue_count"]).toBe(1);

        const enumSchema = structured["enum_schema"];
        assertRecord(enumSchema, "enum_schema");
        assertArray(enumSchema["status"], "enum_schema.status");
        assertArray(enumSchema["layer"], "enum_schema.layer");
        expect(enumSchema["status"]).toContain("draft");
        expect(enumSchema["layer"]).toContain("conceptual");

        const issues = structured["issues"];
        assertArray(issues, "issues");
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("BadEnums.md");
        expect(issues[0]["missing_keys"]).toEqual([]);
        expect(issues[0]["id_matches_created"]).toBe(true);

        const enumViolations = issues[0]["enum_violations"];
        assertArray(enumViolations, "issues[0].enum_violations");
        expect(enumViolations).toHaveLength(3);

        const keys = enumViolations
          .map((entry) => {
            assertRecord(entry, "issues[0].enum_violations[i]");
            return String(entry["key"] ?? "");
          })
          .sort();
        expect(keys).toEqual(["entity", "layer", "status"]);
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

  it("reports typed-link diagnostics in warn mode without failing valid notes", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "OwnerA.md"),
        noteWithFrontmatter({
          id: "20260108123450",
          created: "2026-01-08T12:34:50",
          title: "Owner A",
          entity: "person",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "OwnerB.md"),
        noteWithFrontmatter({
          id: "20260108123451",
          created: "2026-01-08T12:34:51",
          title: "Owner B",
          entity: "person",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "Service.md"),
        noteWithFrontmatter({
          id: "20260108123452",
          created: "2026-01-08T12:34:52",
          title: "Service",
          entity: "procedure",
          layer: "operational",
          typedLinks: ['owned_by: ["[[Owner A]]", "[[Owner B]]"]'],
        }),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(3);
        expect(structured["typed_link_constraint_mode"]).toBe("warn");
        expect(structured["typed_link_diagnostic_count"]).toBe(1);
        expect(structured["ok_count"]).toBe(3);
        expect(structured["issue_count"]).toBe(0);
      });
    });
  });

  it("treats typed-link diagnostics as failures in error mode", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "OwnerA.md"),
        noteWithFrontmatter({
          id: "20260108123500",
          created: "2026-01-08T12:35:00",
          title: "Owner A",
          entity: "person",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "OwnerB.md"),
        noteWithFrontmatter({
          id: "20260108123501",
          created: "2026-01-08T12:35:01",
          title: "Owner B",
          entity: "person",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "Service.md"),
        noteWithFrontmatter({
          id: "20260108123502",
          created: "2026-01-08T12:35:02",
          title: "Service",
          entity: "procedure",
          layer: "operational",
          typedLinks: ['owned_by: ["[[Owner A]]", "[[Owner B]]"]'],
        }),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {
          typed_link_constraint_mode: "error",
        });

        const structured = getStructuredContent(res);
        expect(structured["typed_link_constraint_mode"]).toBe("error");
        expect(structured["typed_link_diagnostic_count"]).toBe(1);
        expect(structured["ok_count"]).toBe(2);
        expect(structured["issue_count"]).toBe(1);

        const issues = structured["issues"];
        assertArray(issues, "issues");
        assertRecord(issues[0], "issues[0]");
        expect(issues[0]["path"]).toBe("Service.md");
        assertArray(issues[0]["typed_link_diagnostics"], "issues[0].typed_link_diagnostics");
      });
    });
  });

  it("detects range and conflict relation diagnostics", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.writeFile(
        path.join(vaultPath, "Owner.md"),
        noteWithFrontmatter({
          id: "20260108123510",
          created: "2026-01-08T12:35:10",
          title: "Owner",
          entity: "person",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "Claim.md"),
        noteWithFrontmatter({
          id: "20260108123511",
          created: "2026-01-08T12:35:11",
          title: "Claim",
          entity: "concept",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(vaultPath, "Procedure.md"),
        noteWithFrontmatter({
          id: "20260108123512",
          created: "2026-01-08T12:35:12",
          title: "Procedure",
          entity: "procedure",
          layer: "operational",
          typedLinks: [
            'produces: ["[[Owner]]"]',
            'supports: ["[[Claim]]"]',
            'contradicts: ["[[Claim]]"]',
          ],
        }),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {});

        const structured = getStructuredContent(res);
        expect(structured["typed_link_diagnostic_count"]).toBe(2);

        const diagnostics = structured["typed_link_diagnostics"];
        assertArray(diagnostics, "typed_link_diagnostics");
        const reasons = diagnostics
          .map((diag) => {
            assertRecord(diag, "typed_link_diagnostics[i]");
            return String(diag["reason"] ?? "");
          })
          .join("\n");

        expect(reasons).toContain(
          'target entity "person" is incompatible with relation "produces"',
        );
        expect(reasons).toContain(
          'conflict: same target appears in both "supports" and "contradicts"',
        );
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

  it("resolves typed-link targets across the whole vault even when path_prefix is set", async () => {
    await withTempDir("ailss-mcp-http-", async (vaultPath) => {
      await fs.mkdir(path.join(vaultPath, "Folder"), { recursive: true });
      await fs.mkdir(path.join(vaultPath, "People"), { recursive: true });

      await fs.writeFile(
        path.join(vaultPath, "People", "Owner.md"),
        noteWithFrontmatter({
          id: "20260108123520",
          created: "2026-01-08T12:35:20",
          title: "Owner",
          entity: "person",
        }),
        "utf8",
      );

      await fs.writeFile(
        path.join(vaultPath, "Folder", "Procedure.md"),
        noteWithFrontmatter({
          id: "20260108123521",
          created: "2026-01-08T12:35:21",
          title: "Procedure",
          entity: "procedure",
          layer: "operational",
          typedLinks: ['produces: ["[[Owner]]"]'],
        }),
        "utf8",
      );

      await withMcpHttpServer({ vaultPath, enableWriteTools: false }, async ({ url, token }) => {
        const sessionId = await mcpInitialize(url, token, "client-a");
        const res = await mcpToolsCall(url, token, sessionId, "frontmatter_validate", {
          path_prefix: "Folder/",
        });

        const structured = getStructuredContent(res);
        expect(structured["files_scanned"]).toBe(1);
        expect(structured["typed_link_diagnostic_count"]).toBe(1);
        expect(structured["ok_count"]).toBe(1);
        expect(structured["issue_count"]).toBe(0);

        const diagnostics = structured["typed_link_diagnostics"];
        assertArray(diagnostics, "typed_link_diagnostics");
        assertRecord(diagnostics[0], "typed_link_diagnostics[0]");
        expect(diagnostics[0]["path"]).toBe("Folder/Procedure.md");
        expect(diagnostics[0]["reason"]).toBe(
          'target entity "person" is incompatible with relation "produces"',
        );
      });
    });
  });
});
