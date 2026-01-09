import { describe, expect, it } from "vitest";

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  assertArray,
  assertRecord,
  mcpInitialize,
  parseFirstSseData,
  withMcpHttpServer,
  withTempDir,
} from "./httpTestUtils.js";

const MCP_PROTOCOL_VERSION = "2025-03-26" as const;

type ListedTool = {
  name?: unknown;
  inputSchema?: unknown;
};

async function mcpToolsList(
  url: string,
  token: string,
  sessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  expect(res.status).toBe(200);
  const payload = parseFirstSseData(await res.text());

  assertRecord(payload, "tools/list payload");
  const result = payload["result"];
  assertRecord(result, "tools/list result");
  const tools = result["tools"];
  assertArray(tools, "result.tools");

  const out: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    assertRecord(tool, "result.tools[i]");
    out.push(tool);
  }
  return out;
}

function toolNamesFromList(tools: Array<Record<string, unknown>>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool["name"];
    if (typeof name !== "string") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function diffSet(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((x) => !bSet.has(x));
}

function extractToolListFromOverview(markdown: string, sectionHeading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((l) => l.trim() === sectionHeading);
  if (headingIndex < 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (!line) {
      if (out.length > 0) break;
      continue;
    }

    // Stop at the next section-like heading.
    if (line.startsWith("#")) break;

    const m = line.match(/^- `([^`]+)`:/);
    if (!m?.[1]) continue;
    const tool = m[1].trim();
    if (!tool) continue;
    if (seen.has(tool)) continue;
    seen.add(tool);
    out.push(tool);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function collectPromptToolMentions(markdown: string): string[] {
  const patterns = [/\bcall\s+`([a-z_]+)`/gi, /\bvia\s+`([a-z_]+)`/gi, /\buse\s+`([a-z_]+)`/gi];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown))) {
      const name = (m[1] ?? "").trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function inputSchemaPropertyNames(inputSchema: unknown): string[] {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return [];
  const props = (inputSchema as Record<string, unknown>)["properties"];
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  return Object.keys(props);
}

describe("Docs/prompt MCP tool consistency", () => {
  it("keeps docs/01-overview.md implemented tool lists in sync with tools/list", async () => {
    await withTempDir("ailss-mcp-docs-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      const readTools = await withMcpHttpServer(
        { dbPath, enableWriteTools: false },
        async (ctx) => {
          const sessionId = await mcpInitialize(ctx.url, ctx.token, "client-docs");
          return toolNamesFromList(await mcpToolsList(ctx.url, ctx.token, sessionId));
        },
      );

      const allTools = await withMcpHttpServer({ dbPath, enableWriteTools: true }, async (ctx) => {
        const sessionId = await mcpInitialize(ctx.url, ctx.token, "client-docs");
        return toolNamesFromList(await mcpToolsList(ctx.url, ctx.token, sessionId));
      });

      const writeTools = diffSet(allTools, readTools).sort((a, b) => a.localeCompare(b));

      const overviewPath = path.join(process.cwd(), "docs", "01-overview.md");
      const overview = await fs.readFile(overviewPath, "utf8");

      const docsReadTools = extractToolListFromOverview(
        overview,
        "Read-first tools (implemented in this repo):",
      );
      const docsWriteTools = extractToolListFromOverview(
        overview,
        "Explicit write tools (apply, implemented):",
      );

      expect(docsReadTools).toEqual(readTools);
      expect(docsWriteTools).toEqual(writeTools);
    });
  });

  it("ensures Codex prompt snippets only reference existing MCP tools", async () => {
    await withTempDir("ailss-mcp-docs-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      const { toolNames, argNames } = await withMcpHttpServer(
        { dbPath, enableWriteTools: true },
        async (ctx) => {
          const sessionId = await mcpInitialize(ctx.url, ctx.token, "client-docs");
          const tools = (await mcpToolsList(ctx.url, ctx.token, sessionId)) as ListedTool[];

          const toolNames = new Set<string>();
          const argNames = new Set<string>();

          for (const t of tools) {
            if (typeof t.name === "string") toolNames.add(t.name);
            for (const key of inputSchemaPropertyNames(t.inputSchema)) {
              argNames.add(key);
            }
          }

          return { toolNames, argNames };
        },
      );

      const promptPaths = [
        path.join(process.cwd(), "docs", "ops", "codex-prompts", "prometheus-agent.md"),
        path.join(process.cwd(), "docs", "ops", "codex-prompts", "ailss-note-create.md"),
      ];

      for (const promptPath of promptPaths) {
        const text = await fs.readFile(promptPath, "utf8");

        // Guard against reintroducing the known mismatch pattern.
        if (promptPath.endsWith("prometheus-agent.md")) {
          expect(text).not.toMatch(/incoming\s*\+\s*outgoing/i);
          expect(text).not.toMatch(/up to\s+2\s+hops/i);
        }

        const mentions = collectPromptToolMentions(text);
        for (const name of mentions) {
          if (toolNames.has(name)) continue;
          if (argNames.has(name)) continue;

          throw new Error(
            [
              "Unknown identifier referenced in prompt snippet.",
              `file="${path.relative(process.cwd(), promptPath)}"`,
              `name="${name}"`,
            ].join(" "),
          );
        }
      }
    });
  });
});
