import { describe, expect, it } from "vitest";

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

describe("MCP HTTP server (find_broken_links)", () => {
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

          // One valid typed link and six broken ones.
          linkStmt.run("A.md", "depends_on", "B", "[[B]]", 0, now);
          linkStmt.run("A.md", "depends_on", "Missing", "[[Missing]]", 1, now);
          linkStmt.run("A.md", "cites", "Nope", "[[Nope]]", 0, now);
          linkStmt.run("A.md", "verifies", "UnverifiedClaim", "[[UnverifiedClaim]]", 0, now);
          linkStmt.run("A.md", "measures", "UnknownMetric", "[[UnknownMetric]]", 0, now);
          linkStmt.run("A.md", "owned_by", "UnknownOwner", "[[UnknownOwner]]", 0, now);
          linkStmt.run("A.md", "produces", "MissingArtifact", "[[MissingArtifact]]", 0, now);

          const sessionId = await mcpInitialize(url, token, "client-a");
          const res = await mcpToolsCall(url, token, sessionId, "find_broken_links", {
            path_prefix: "A",
            max_links: 100,
            max_broken: 100,
            max_resolutions_per_target: 5,
          });

          const structured = getStructuredContent(res);
          expect(structured["scanned_links"]).toBe(7);
          expect(structured["broken_total"]).toBe(6);

          const broken = structured["broken"];
          assertArray(broken, "broken");
          const targets = broken
            .map((b) => {
              assertRecord(b, "broken[i]");
              return String(b["target"] ?? "");
            })
            .sort();

          expect(targets).toEqual([
            "Missing",
            "MissingArtifact",
            "Nope",
            "UnknownMetric",
            "UnknownOwner",
            "UnverifiedClaim",
          ]);
        },
      );
    });
  });

  it("treats ambiguous targets as broken when enabled", async () => {
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
          fileStmt.run("sub/B.md", 0, 0, "0", now);

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
            "B1",
            now,
            "B",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "B1", title: "B", tags: [] }),
            now,
          );
          noteStmt.run(
            "sub/B.md",
            "B2",
            now,
            "B",
            null,
            null,
            "conceptual",
            "draft",
            now,
            JSON.stringify({ id: "B2", title: "B", tags: [] }),
            now,
          );

          // One ambiguous typed link and one missing target.
          linkStmt.run("A.md", "depends_on", "B", "[[B]]", 0, now);
          linkStmt.run("A.md", "depends_on", "Missing", "[[Missing]]", 1, now);

          const sessionId = await mcpInitialize(url, token, "client-a");

          const defaultRes = await mcpToolsCall(url, token, sessionId, "find_broken_links", {
            path_prefix: "A",
            max_links: 100,
            max_broken: 100,
            max_resolutions_per_target: 5,
          });

          const defaultStructured = getStructuredContent(defaultRes);
          expect(defaultStructured["scanned_links"]).toBe(2);
          expect(defaultStructured["broken_total"]).toBe(2);

          const defaultBroken = defaultStructured["broken"];
          assertArray(defaultBroken, "broken");
          expect(defaultBroken).toHaveLength(2);

          const ambiguous = defaultBroken.find((b) => {
            assertRecord(b, "broken[i]");
            return String(b["target"] ?? "") === "B";
          });
          expect(ambiguous).toBeTruthy();
          assertRecord(ambiguous, "ambiguous");
          assertArray(ambiguous["resolutions"], "ambiguous.resolutions");

          const resolutionPaths = ambiguous["resolutions"]
            .map((r) => {
              assertRecord(r, "resolutions[i]");
              return String(r["path"] ?? "");
            })
            .sort();
          expect(resolutionPaths).toEqual(["B.md", "sub/B.md"]);

          const cappedRes = await mcpToolsCall(url, token, sessionId, "find_broken_links", {
            path_prefix: "A",
            max_links: 100,
            max_broken: 100,
            max_resolutions_per_target: 1,
          });

          const cappedStructured = getStructuredContent(cappedRes);
          expect(cappedStructured["scanned_links"]).toBe(2);
          expect(cappedStructured["broken_total"]).toBe(2);

          const cappedBroken = cappedStructured["broken"];
          assertArray(cappedBroken, "broken");

          const cappedAmbiguous = cappedBroken.find((b) => {
            assertRecord(b, "broken[i]");
            return String(b["target"] ?? "") === "B";
          });
          expect(cappedAmbiguous).toBeTruthy();
          assertRecord(cappedAmbiguous, "cappedAmbiguous");
          assertArray(cappedAmbiguous["resolutions"], "cappedAmbiguous.resolutions");
          expect(cappedAmbiguous["resolutions"]).toHaveLength(1);

          const firstResolution = cappedAmbiguous["resolutions"][0];
          assertRecord(firstResolution, "cappedAmbiguous.resolutions[0]");
          expect(firstResolution["path"]).toBe("B.md");

          const disabledRes = await mcpToolsCall(url, token, sessionId, "find_broken_links", {
            path_prefix: "A",
            max_links: 100,
            max_broken: 100,
            max_resolutions_per_target: 1,
            treat_ambiguous_as_broken: false,
          });

          const disabledStructured = getStructuredContent(disabledRes);
          expect(disabledStructured["scanned_links"]).toBe(2);
          expect(disabledStructured["broken_total"]).toBe(1);

          const disabledBroken = disabledStructured["broken"];
          assertArray(disabledBroken, "broken");
          const disabledTargets = disabledBroken
            .map((b) => {
              assertRecord(b, "broken[i]");
              return String(b["target"] ?? "");
            })
            .sort();
          expect(disabledTargets).toEqual(["Missing"]);
        },
      );
    });
  });
});
