// get_vault_tree tool
// - filesystem folder tree for the vault (no DB required)

import path from "node:path";

import { listMarkdownFiles } from "@ailss/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { McpToolDeps } from "../mcpDeps.js";

type NodeType = "dir" | "file";
type TreeNode = {
  name: string;
  type: NodeType;
  children: Map<string, TreeNode>;
};

function relPathFromAbs(vaultPath: string, absPath: string): string {
  return path.relative(vaultPath, absPath).split(path.sep).join(path.posix.sep);
}

function ensureChildDir(parent: TreeNode, name: string): TreeNode {
  const existing = parent.children.get(name);
  if (existing) return existing;
  const next: TreeNode = { name, type: "dir", children: new Map() };
  parent.children.set(name, next);
  return next;
}

function addPath(root: TreeNode, relPath: string, type: NodeType): void {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length === 0) return;

  let node = root;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] ?? "";
    const isLast = i === segments.length - 1;
    if (!isLast) {
      node = ensureChildDir(node, seg);
      continue;
    }

    if (type === "dir") {
      ensureChildDir(node, seg);
      return;
    }

    if (node.children.has(seg)) return;
    node.children.set(seg, { name: seg, type: "file", children: new Map() });
  }
}

function sortChildren(children: Iterable<TreeNode>): TreeNode[] {
  return Array.from(children).sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function renderTree(options: { root: TreeNode; maxDepth: number; maxNodes: number }): {
  tree: string;
  nodeCount: number;
  truncated: boolean;
} {
  const lines: string[] = ["."];
  let nodeCount = 0;
  let truncated = false;

  const walk = (node: TreeNode, prefix: string, depth: number): void => {
    if (depth >= options.maxDepth) {
      if (node.children.size > 0) {
        lines.push(`${prefix}└── …`);
        truncated = true;
        nodeCount += 1;
      }
      return;
    }

    const children = sortChildren(node.children.values());
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!child) continue;
      if (nodeCount >= options.maxNodes) {
        truncated = true;
        return;
      }

      const isLast = i === children.length - 1;
      const connector = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${connector}${child.name}`);
      nodeCount += 1;

      if (child.type === "dir") {
        const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
        walk(child, nextPrefix, depth + 1);
        if (truncated && nodeCount >= options.maxNodes) return;
      }
    }
  };

  walk(options.root, "", 0);
  return { tree: lines.join("\n"), nodeCount, truncated };
}

export function registerGetVaultTreeTool(server: McpServer, deps: McpToolDeps): void {
  server.registerTool(
    "get_vault_tree",
    {
      title: "Get vault tree",
      description:
        "Returns a folder tree view of markdown files in the vault. Requires AILSS_VAULT_PATH. Ignores vault-internal/system folders (e.g. .obsidian, .ailss).",
      inputSchema: {
        path_prefix: z
          .string()
          .min(1)
          .optional()
          .describe("Only include notes under this vault-relative path prefix"),
        include_files: z
          .boolean()
          .default(false)
          .describe("Include files (markdown notes) in the tree"),
        max_depth: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(8)
          .describe("Maximum tree depth to render (1–50)"),
        max_nodes: z
          .number()
          .int()
          .min(1)
          .max(20_000)
          .default(2000)
          .describe("Maximum number of nodes to render (folders + files)"),
      },
      outputSchema: z.object({
        path_prefix: z.string().nullable(),
        include_files: z.boolean(),
        max_depth: z.number().int(),
        max_nodes: z.number().int(),
        files_scanned: z.number().int().nonnegative(),
        folder_count: z.number().int().nonnegative(),
        file_count: z.number().int().nonnegative(),
        node_count: z.number().int().nonnegative(),
        truncated: z.boolean(),
        folders: z.array(z.string()),
        files: z.array(z.string()),
        tree: z.string(),
      }),
    },
    async (args) => {
      const vaultPath = deps.vaultPath;
      if (!vaultPath) {
        throw new Error("Cannot read vault tree because AILSS_VAULT_PATH is not set.");
      }

      const prefix = args.path_prefix ? args.path_prefix.trim() : null;
      const absFiles = await listMarkdownFiles(vaultPath);
      const relFiles = absFiles.map((abs) => relPathFromAbs(vaultPath, abs));
      const filteredFiles = prefix ? relFiles.filter((p) => p.startsWith(prefix)) : relFiles;

      const folderSet = new Set<string>();
      for (const filePath of filteredFiles) {
        const parts = filePath.split("/").filter(Boolean);
        for (let i = 0; i < parts.length - 1; i += 1) {
          const folder = parts.slice(0, i + 1).join("/");
          folderSet.add(folder);
        }
      }

      const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b));
      const files = args.include_files
        ? filteredFiles.slice().sort((a, b) => a.localeCompare(b))
        : [];

      const root: TreeNode = { name: "", type: "dir", children: new Map() };
      for (const folder of folders) addPath(root, folder, "dir");
      if (args.include_files) {
        for (const file of files) addPath(root, file, "file");
      }

      const rendered = renderTree({ root, maxDepth: args.max_depth, maxNodes: args.max_nodes });

      const payload = {
        path_prefix: prefix,
        include_files: Boolean(args.include_files),
        max_depth: args.max_depth,
        max_nodes: args.max_nodes,
        files_scanned: filteredFiles.length,
        folder_count: folders.length,
        file_count: files.length,
        node_count: rendered.nodeCount,
        truncated: rendered.truncated,
        folders,
        files,
        tree: rendered.tree,
      };

      return {
        structuredContent: payload,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
