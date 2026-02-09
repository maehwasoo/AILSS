import { describe, expect, it } from "vitest";

import path from "node:path";

import type { AilssMcpRuntime } from "../src/createAilssMcpServer.js";
import { AsyncMutex } from "../src/lib/asyncMutex.js";
import { startAilssMcpHttpServer } from "../src/httpServer.js";

import {
  insertChunkWithEmbedding,
  openAilssDb,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  upsertFile,
  upsertNote,
} from "@ailss/core";

import {
  assertArray,
  getStructuredContent,
  mcpInitialize,
  mcpToolsCall,
  withTempDir,
} from "./httpTestUtils.js";

const TEST_TOKEN = "test-token";

function upsertIndexedNote(params: {
  runtime: AilssMcpRuntime;
  path: string;
  title: string;
  summary: string;
  embedding: number[];
  typedLinks?: Array<{ rel: string; target: string }>;
  tags?: string[];
  keywords?: string[];
}): void {
  const now = new Date().toISOString().slice(0, 19);
  const db = params.runtime.deps.db;

  upsertFile(db, { path: params.path, mtimeMs: 0, sizeBytes: 0, sha256: `${params.path}-sha` });
  upsertNote(db, {
    path: params.path,
    noteId: path.basename(params.path, ".md"),
    created: now,
    title: params.title,
    summary: params.summary,
    entity: "concept",
    layer: "conceptual",
    status: "draft",
    updated: now,
    frontmatterJson: JSON.stringify({
      id: path.basename(params.path, ".md"),
      title: params.title,
      summary: params.summary,
      tags: params.tags ?? [],
      keywords: params.keywords ?? [],
    }),
  });
  replaceNoteTags(db, params.path, params.tags ?? []);
  replaceNoteKeywords(db, params.path, params.keywords ?? []);
  replaceTypedLinks(
    db,
    params.path,
    (params.typedLinks ?? []).map((link, index) => ({
      rel: link.rel,
      toTarget: link.target,
      toWikilink: `[[${link.target}]]`,
      position: index,
    })),
  );
  insertChunkWithEmbedding(db, {
    chunkId: `${params.path}-chunk`,
    path: params.path,
    heading: params.title,
    headingPathJson: JSON.stringify([params.title]),
    content: `${params.title} content`,
    contentSha256: `${params.path}-chunk-sha`,
    embedding: params.embedding,
  });
}

describe("MCP HTTP server (get_graph_context)", () => {
  it("returns graph-rag payload with scoped outgoing expansion", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
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
          vaultPath: undefined,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertIndexedNote({
        runtime,
        path: "Domain/A.md",
        title: "A",
        summary: "summary A",
        embedding: [0, 0, 0],
        typedLinks: [
          { rel: "uses", target: "B" },
          { rel: "uses", target: "X" },
        ],
      });
      upsertIndexedNote({
        runtime,
        path: "Domain/B.md",
        title: "B",
        summary: "summary B",
        embedding: [0.1, 0, 0],
        typedLinks: [{ rel: "depends_on", target: "C" }],
      });
      upsertIndexedNote({
        runtime,
        path: "Domain/C.md",
        title: "C",
        summary: "summary C",
        embedding: [0.2, 0, 0],
      });
      upsertIndexedNote({
        runtime,
        path: "Other/X.md",
        title: "X",
        summary: "summary X",
        embedding: [0.05, 0, 0],
      });

      const { close, url } = await startAilssMcpHttpServer({
        runtime,
        config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
        maxSessions: 5,
        idleTtlMs: 60_000,
      });

      try {
        const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-a");
        const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_graph_context", {
          query: "query",
          seed_top_k: 2,
          max_hops: 1,
          path_prefix: "Domain/",
          rels: ["uses", "depends_on"],
          include_backrefs: false,
          max_notes: 20,
          max_edges: 20,
          max_links_per_note: 10,
          max_chunks_per_note: 2,
        });

        const structured = getStructuredContent(res);

        const seeds = structured["seeds"];
        assertArray(seeds, "seeds");
        expect(seeds.length).toBeGreaterThanOrEqual(1);
        expect((seeds[0] as Record<string, unknown>)["path"]).toBe("Domain/A.md");

        const graph = structured["graph"] as Record<string, unknown>;
        const nodes = graph["nodes"];
        assertArray(nodes, "graph.nodes");
        const nodePaths = nodes.map((node) => (node as Record<string, unknown>)["path"]).sort();
        expect(nodePaths).toEqual(["Domain/A.md", "Domain/B.md", "Domain/C.md"]);

        const edges = graph["edges"];
        assertArray(edges, "graph.edges");
        expect(edges.length).toBe(2);
        const edgeDirections = edges.map(
          (edge) => (edge as Record<string, unknown>)["direction"] as string,
        );
        expect(new Set(edgeDirections)).toEqual(new Set(["outgoing"]));

        const edgeTargets = edges
          .map((edge) => (edge as Record<string, unknown>)["to_path"])
          .sort();
        expect(edgeTargets).toEqual(["Domain/B.md", "Domain/C.md"]);

        const contextNotes = structured["context_notes"];
        assertArray(contextNotes, "context_notes");
        expect(contextNotes.length).toBe(3);
        expect(
          contextNotes.map((note) => (note as Record<string, unknown>)["path"]).sort(),
        ).toEqual(["Domain/A.md", "Domain/B.md", "Domain/C.md"]);
      } finally {
        await close();
        db.close();
      }
    });
  });

  it("includes incoming edges when include_backrefs=true", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
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
          vaultPath: undefined,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertIndexedNote({
        runtime,
        path: "Domain/A.md",
        title: "A",
        summary: "summary A",
        embedding: [0, 0, 0],
      });
      upsertIndexedNote({
        runtime,
        path: "Domain/B.md",
        title: "B",
        summary: "summary B",
        embedding: [0.2, 0, 0],
        typedLinks: [{ rel: "part_of", target: "A" }],
      });

      const { close, url } = await startAilssMcpHttpServer({
        runtime,
        config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
        maxSessions: 5,
        idleTtlMs: 60_000,
      });

      try {
        const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-b");
        const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_graph_context", {
          query: "query",
          seed_top_k: 1,
          max_hops: 1,
          path_prefix: "Domain/",
          rels: ["part_of"],
          include_backrefs: true,
          max_notes: 20,
          max_edges: 20,
          max_links_per_note: 10,
          max_chunks_per_note: 1,
        });

        const structured = getStructuredContent(res);
        const graph = structured["graph"] as Record<string, unknown>;
        const edges = graph["edges"];
        assertArray(edges, "graph.edges");
        expect(edges.length).toBe(1);

        const edge = edges[0] as Record<string, unknown>;
        expect(edge["direction"]).toBe("incoming");
        expect(edge["from_path"]).toBe("Domain/B.md");
        expect(edge["to_path"]).toBe("Domain/A.md");

        const nodes = graph["nodes"];
        assertArray(nodes, "graph.nodes");
        expect(nodes.map((node) => (node as Record<string, unknown>)["path"]).sort()).toEqual([
          "Domain/A.md",
          "Domain/B.md",
        ]);
      } finally {
        await close();
        db.close();
      }
    });
  });

  it("caps outgoing edges per note when one link resolves to multiple paths", async () => {
    await withTempDir("ailss-mcp-http-", async (dir) => {
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
          vaultPath: undefined,
          openai: openaiStub,
          embeddingModel: "test-embeddings",
          writeLock: new AsyncMutex(),
        },
        enableWriteTools: false,
      };

      upsertIndexedNote({
        runtime,
        path: "Domain/A.md",
        title: "A",
        summary: "summary A",
        embedding: [0, 0, 0],
        typedLinks: [{ rel: "uses", target: "Shared" }],
      });
      upsertIndexedNote({
        runtime,
        path: "Domain/Shared-1.md",
        title: "Shared",
        summary: "summary Shared 1",
        embedding: [5, 0, 0],
      });
      upsertIndexedNote({
        runtime,
        path: "Domain/Shared-2.md",
        title: "Shared",
        summary: "summary Shared 2",
        embedding: [6, 0, 0],
      });

      const { close, url } = await startAilssMcpHttpServer({
        runtime,
        config: { host: "127.0.0.1", port: 0, path: "/mcp", token: TEST_TOKEN },
        maxSessions: 5,
        idleTtlMs: 60_000,
      });

      try {
        const sessionId = await mcpInitialize(url, TEST_TOKEN, "client-c");
        const res = await mcpToolsCall(url, TEST_TOKEN, sessionId, "get_graph_context", {
          query: "query",
          seed_top_k: 1,
          max_hops: 1,
          path_prefix: "Domain/",
          rels: ["uses"],
          include_backrefs: false,
          max_notes: 20,
          max_edges: 20,
          max_links_per_note: 1,
          max_chunks_per_note: 1,
        });

        const structured = getStructuredContent(res);
        const graph = structured["graph"] as Record<string, unknown>;
        const edges = graph["edges"];
        assertArray(edges, "graph.edges");

        const outgoingFromA = edges.filter(
          (edge) =>
            (edge as Record<string, unknown>)["direction"] === "outgoing" &&
            (edge as Record<string, unknown>)["from_path"] === "Domain/A.md",
        );

        expect(outgoingFromA).toHaveLength(1);
      } finally {
        await close();
        db.close();
      }
    });
  });
});
