import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import {
  insertChunkWithEmbedding,
  openAilssDb,
  replaceNoteKeywords,
  replaceNoteTags,
  upsertFile,
  upsertNote,
} from "@ailss/core";

import { getStructuredContent, mcpInitialize, mcpToolsCall, withTempDir } from "./httpTestUtils.js";
import { TEST_TOKEN, throwIfToolCallFailed } from "./httpTools.getContext.testUtils.js";

describe("MCP HTTP server (get_context)", () => {
  it("keeps a stable structuredContent contract (golden payload)", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
      const vaultPath = path.join(dir, "vault");
      await fs.mkdir(path.join(vaultPath, "Notes"), { recursive: true });
      await fs.writeFile(
        path.join(vaultPath, "Notes/Alpha.md"),
        `${"A".repeat(260)}\nalpha body\n`,
        "utf8",
      );
      await fs.writeFile(path.join(vaultPath, "Notes/Beta.md"), "beta file\n", "utf8");

      const dbPath = path.join(dir, "index.sqlite");
      const db = openAilssDb({ dbPath, embeddingModel: "test-embeddings", embeddingDim: 3 });

      const queryEmbedding = [0, 0, 0];
      const openaiStub = {
        embeddings: {
          create: async () => ({ data: [{ embedding: queryEmbedding }] }),
        },
      } as unknown as AilssMcpRuntime["deps"]["openai"];

      const runtime: AilssMcpRuntime = {
        deps: {
          db,
          dbPath,
          vaultPath,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertFile(db, { path: "Notes/Alpha.md", mtimeMs: 0, sizeBytes: 0, sha256: "a" });
      upsertFile(db, { path: "Notes/Beta.md", mtimeMs: 0, sizeBytes: 0, sha256: "b" });

      upsertNote(db, {
        path: "Notes/Alpha.md",
        noteId: "alpha",
        created: null,
        title: "Alpha title",
        summary: "Alpha summary",
        entity: null,
        layer: null,
        status: null,
        updated: null,
        frontmatterJson: "{}",
      });
      upsertNote(db, {
        path: "Notes/Beta.md",
        noteId: "beta",
        created: null,
        title: "Beta title",
        summary: null,
        entity: null,
        layer: null,
        status: null,
        updated: null,
        frontmatterJson: "{}",
      });

      replaceNoteTags(db, "Notes/Alpha.md", ["project", "golden"]);
      replaceNoteTags(db, "Notes/Beta.md", ["project", "golden"]);
      replaceNoteKeywords(db, "Notes/Alpha.md", ["retrieval", "contract"]);
      replaceNoteKeywords(db, "Notes/Beta.md", []);

      insertChunkWithEmbedding(db, {
        chunkId: "alpha-neighbor-0",
        path: "Notes/Alpha.md",
        chunkIndex: 0,
        heading: "Alpha Neighbor",
        headingPathJson: JSON.stringify(["Alpha", "Neighbor"]),
        content: "alpha-neighbor",
        contentSha256: "sha-alpha-0",
        embedding: [2, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "alpha-best-1",
        path: "Notes/Alpha.md",
        chunkIndex: 1,
        heading: "Alpha Best",
        headingPathJson: JSON.stringify(["Alpha", "Best"]),
        content: "alpha-best",
        contentSha256: "sha-alpha-1",
        embedding: [0, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "alpha-hit-3",
        path: "Notes/Alpha.md",
        chunkIndex: 3,
        heading: "Alpha Hit 2",
        headingPathJson: JSON.stringify(["Alpha", "Hit 2"]),
        content: "alpha-second-hit",
        contentSha256: "sha-alpha-3",
        embedding: [1, 0, 0],
      });
      insertChunkWithEmbedding(db, {
        chunkId: "beta-hit-0",
        path: "Notes/Beta.md",
        chunkIndex: 0,
        heading: null,
        headingPathJson: JSON.stringify([]),
        content: "beta-only-hit",
        contentSha256: "sha-beta-0",
        embedding: [0, 2, 0],
      });

      const { close, url } = await startAilssMcpHttpServer({
        runtime,
        config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
        maxSessions: 5,
        idleTtlMs: 60_000,
      });

      try {
        const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-a");
        const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_context", {
          query: "contract query",
          path_prefix: "Notes/",
          tags_any: ["project"],
          tags_all: ["golden"],
          top_k: 2,
          expand_top_k: 1,
          hit_chunks_per_note: 2,
          neighbor_window: 1,
          max_evidence_chars_per_note: 200,
          include_file_preview: true,
          max_chars_per_note: 200,
        });

        throwIfToolCallFailed(res);
        const structured = getStructuredContent(res);

        const normalized = {
          ...structured,
          db: "<temp-db-path>",
        };

        expect(normalized).toEqual({
          query: "contract query",
          top_k: 2,
          db: "<temp-db-path>",
          used_chunks_k: 50,
          applied_filters: {
            path_prefix: "Notes/",
            tags_any: ["project"],
            tags_all: ["golden"],
          },
          params: {
            expand_top_k: 1,
            hit_chunks_per_note: 2,
            neighbor_window: 1,
            max_evidence_chars_per_note: 200,
            include_file_preview: true,
            max_chars_per_note: 200,
          },
          results: [
            {
              path: "Notes/Alpha.md",
              distance: 0,
              title: "Alpha title",
              summary: "Alpha summary",
              tags: ["golden", "project"],
              keywords: ["contract", "retrieval"],
              heading: "Alpha Best",
              heading_path: ["Alpha", "Best"],
              snippet: "alpha-neighbor\n\nalpha-best\n\nalpha-second-hit",
              evidence_text: "alpha-neighbor\n\nalpha-best\n\nalpha-second-hit",
              evidence_truncated: false,
              evidence_chunks: [
                {
                  chunk_id: "alpha-neighbor-0",
                  chunk_index: 0,
                  kind: "neighbor",
                  distance: null,
                  heading: "Alpha Neighbor",
                  heading_path: ["Alpha", "Neighbor"],
                },
                {
                  chunk_id: "alpha-best-1",
                  chunk_index: 1,
                  kind: "hit",
                  distance: 0,
                  heading: "Alpha Best",
                  heading_path: ["Alpha", "Best"],
                },
                {
                  chunk_id: "alpha-hit-3",
                  chunk_index: 3,
                  kind: "hit",
                  distance: 1,
                  heading: "Alpha Hit 2",
                  heading_path: ["Alpha", "Hit 2"],
                },
              ],
              preview: "A".repeat(200),
              preview_truncated: true,
            },
            {
              path: "Notes/Beta.md",
              distance: 2,
              title: "Beta title",
              summary: null,
              tags: ["golden", "project"],
              keywords: [],
              heading: null,
              heading_path: [],
              snippet: "beta-only-hit",
              evidence_text: null,
              evidence_truncated: false,
              evidence_chunks: [],
              preview: "beta file\n",
              preview_truncated: false,
            },
          ],
        });
      } finally {
        await close();
        db.close();
      }
    });
  });
});
