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

function extractYamlFrontmatterBlock(markdown: string): string | null {
  const normalized = (markdown ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return null;

  const endIndex = lines.slice(1).findIndex((l) => (l ?? "").trim() === "---");
  if (endIndex < 0) return null;

  const fmStart = 1;
  const fmEnd = 1 + endIndex;
  return lines.slice(fmStart, fmEnd).join("\n");
}

function extractMcpToolsFromPromptFrontmatter(markdown: string): string[] | null {
  const frontmatter = extractYamlFrontmatterBlock(markdown);
  if (!frontmatter) return null;

  const lines = frontmatter.split("\n");
  const start = lines.findIndex((l) => (l ?? "").trim() === "mcp_tools:");
  if (start < 0) return null;

  const tools: string[] = [];
  const seen = new Set<string>();

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    // Stop when reaching another top-level key.
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line.trim())) break;

    const m = line.match(/^\s*-\s*(.+?)\s*$/);
    if (!m?.[1]) continue;
    const tool = m[1].trim();
    if (!tool) continue;
    if (seen.has(tool)) continue;
    seen.add(tool);
    tools.push(tool);
  }

  return tools;
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

  it("warns when Codex prompt metadata references unknown MCP tools", async () => {
    await withTempDir("ailss-mcp-docs-", async (dir) => {
      const dbPath = path.join(dir, "index.sqlite");

      const toolNames = await withMcpHttpServer({ dbPath, enableWriteTools: true }, async (ctx) => {
        const sessionId = await mcpInitialize(ctx.url, ctx.token, "client-docs");
        const tools = (await mcpToolsList(ctx.url, ctx.token, sessionId)) as ListedTool[];

        const toolNames = new Set<string>();
        for (const t of tools) {
          if (typeof t.name === "string") toolNames.add(t.name);
        }

        return toolNames;
      });

      const promptPaths = [
        path.join(process.cwd(), "docs", "ops", "codex-skills", "prometheus-agent", "SKILL.md"),
        path.join(process.cwd(), "docs", "ops", "codex-prompts", "ailss-note-create.md"),
      ];

      const issues: Array<{ file: string; message: string }> = [];

      for (const promptPath of promptPaths) {
        const text = await fs.readFile(promptPath, "utf8");

        // Guard against reintroducing the known mismatch pattern (warn-only).
        if (promptPath.endsWith("prometheus-agent.md")) {
          if (/incoming\s*\+\s*outgoing/i.test(text)) {
            issues.push({
              file: path.relative(process.cwd(), promptPath),
              message: 'Contains outdated phrase: "incoming + outgoing"',
            });
          }
          if (/up to\s+2\s+hops/i.test(text)) {
            issues.push({
              file: path.relative(process.cwd(), promptPath),
              message: 'Contains outdated phrase: "up to 2 hops"',
            });
          }
        }

        const declaredTools = extractMcpToolsFromPromptFrontmatter(text);
        if (!declaredTools || declaredTools.length === 0) {
          issues.push({
            file: path.relative(process.cwd(), promptPath),
            message: "Missing prompt frontmatter key: mcp_tools",
          });
          continue;
        }

        for (const tool of declaredTools) {
          if (toolNames.has(tool)) continue;
          issues.push({
            file: path.relative(process.cwd(), promptPath),
            message: `Unknown MCP tool in mcp_tools: ${JSON.stringify(tool)}`,
          });
        }
      }

      if (issues.length > 0) {
        // Warn by default; allow strict failure mode when explicitly enabled.
        const strict = (process.env.AILSS_STRICT_PROMPT_LINT ?? "").trim() === "1";
        const header = strict ? "[prompt-lint] FAIL" : "[prompt-lint] WARN";

        const lines = issues.map((i) => `- ${i.file}: ${i.message}`);

        console.warn([header, ...lines].join("\n"));

        if (strict) {
          throw new Error("Prompt lint failed (set AILSS_STRICT_PROMPT_LINT=0 to warn only).");
        }
      }
    });
  });
});
