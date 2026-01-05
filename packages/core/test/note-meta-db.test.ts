// Note metadata + typed links DB tests

import { afterEach, describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findNotesByTypedLink,
  openAilssDb,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  searchNotes,
  upsertFile,
  upsertNote,
} from "../src/index.js";

let tempDir: string | null = null;

async function mkTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-"));
  tempDir = dir;
  return dir;
}

afterEach(async () => {
  if (!tempDir) return;
  await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("notes + typed_links queries", () => {
  it("searchNotes() filters by fields and tags", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingDim: 3 });

    try {
      upsertFile(db, { path: "notes/a.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertNote(db, {
        path: "notes/a.md",
        noteId: "20260101000000",
        created: "2026-01-01T00:00:00",
        title: "Project A",
        summary: null,
        entity: "project",
        layer: "strategic",
        status: "draft",
        updated: null,
        viewed: 0,
        frontmatterJson: JSON.stringify({ title: "Project A" }),
      });
      replaceNoteTags(db, "notes/a.md", ["inbox", "project"]);
      replaceNoteKeywords(db, "notes/a.md", ["llm"]);

      upsertFile(db, { path: "notes/b.md", mtimeMs: 0, sizeBytes: 0, sha256: "b" });
      upsertNote(db, {
        path: "notes/b.md",
        noteId: "20260102000000",
        created: "2026-01-02T00:00:00",
        title: "Concept B",
        summary: null,
        entity: "concept",
        layer: "conceptual",
        status: "published",
        updated: null,
        viewed: 1,
        frontmatterJson: JSON.stringify({ title: "Concept B" }),
      });
      replaceNoteTags(db, "notes/b.md", ["reference"]);
      replaceNoteKeywords(db, "notes/b.md", []);

      expect(searchNotes(db, { entity: "project" }).map((r) => r.path)).toEqual(["notes/a.md"]);
      expect(searchNotes(db, { layer: "conceptual" }).map((r) => r.path)).toEqual(["notes/b.md"]);
      expect(searchNotes(db, { tagsAny: ["project"] }).map((r) => r.path)).toEqual(["notes/a.md"]);
      expect(searchNotes(db, { tagsAll: ["inbox", "project"] }).map((r) => r.path)).toEqual([
        "notes/a.md",
      ]);
    } finally {
      db.close();
    }
  });

  it("findNotesByTypedLink() returns backrefs for a target", async () => {
    const dir = await mkTempDir();
    const dbPath = path.join(dir, "index.sqlite");
    const db = openAilssDb({ dbPath, embeddingDim: 3 });

    try {
      upsertFile(db, { path: "notes/a.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertNote(db, {
        path: "notes/a.md",
        noteId: null,
        created: null,
        title: "A",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        viewed: null,
        frontmatterJson: "{}",
      });

      replaceTypedLinks(db, "notes/a.md", [
        { rel: "part_of", toTarget: "WorldAce", toWikilink: "[[WorldAce]]", position: 0 },
        { rel: "depends_on", toTarget: "Vite", toWikilink: "[[Vite]]", position: 0 },
      ]);

      const backrefs = findNotesByTypedLink(db, { rel: "part_of", toTarget: "WorldAce" });
      expect(backrefs).toHaveLength(1);
      expect(backrefs[0]?.fromPath).toBe("notes/a.md");
      expect(backrefs[0]?.fromTitle).toBe("A");
      expect(backrefs[0]?.rel).toBe("part_of");
      expect(backrefs[0]?.toTarget).toBe("WorldAce");
    } finally {
      db.close();
    }
  });
});
