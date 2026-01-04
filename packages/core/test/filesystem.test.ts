// Vault file system utility tests

import { afterEach, describe, expect, it } from "vitest";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { listMarkdownFiles, statMarkdownFile } from "../src/vault/filesystem.js";

let tempDir: string | null = null;

async function mkTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-"));
  tempDir = dir;
  return dir;
}

async function writeFile(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf8");
}

afterEach(async () => {
  if (!tempDir) return;
  await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("listMarkdownFiles()", () => {
  it("excludes default ignored directories from scanning", async () => {
    const vaultPath = await mkTempDir();

    // Normal folder (notes)
    await writeFile(path.join(vaultPath, "notes/a.md"), "# A");
    await writeFile(path.join(vaultPath, "notes/b.txt"), "not markdown");
    await writeFile(path.join(vaultPath, "notes/nested/c.md"), "# C");

    // Ignored folders
    await writeFile(path.join(vaultPath, ".git/ignored.md"), "# ignored");
    await writeFile(path.join(vaultPath, ".obsidian/ignored.md"), "# ignored");
    await writeFile(path.join(vaultPath, ".trash/ignored.md"), "# ignored");
    await writeFile(path.join(vaultPath, ".ailss/ignored.md"), "# ignored");
    await writeFile(path.join(vaultPath, "node_modules/ignored.md"), "# ignored");

    const absPaths = await listMarkdownFiles(vaultPath);
    const relPaths = absPaths.map((p) => path.relative(vaultPath, p));

    expect(relPaths).toEqual(["notes/a.md", "notes/nested/c.md"]);
  });
});

describe("statMarkdownFile()", () => {
  it("computes sha256 and returns a vault-relative path", async () => {
    const vaultPath = await mkTempDir();
    const absPath = path.join(vaultPath, "notes/a.md");
    const content = "hello";
    await writeFile(absPath, content);

    const stat = await statMarkdownFile(vaultPath, absPath);

    const expectedSha = createHash("sha256").update(content).digest("hex");
    expect(stat.relPath).toBe("notes/a.md");
    expect(stat.sha256).toBe(expectedSha);
    expect(stat.size).toBe(content.length);
  });
});
