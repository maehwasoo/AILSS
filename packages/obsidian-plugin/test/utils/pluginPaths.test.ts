import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_SETTINGS } from "../../src/settings.js";
import {
	resolveIndexerArgs,
	resolveMcpArgs,
	resolveMcpHttpArgs,
	resolvePythonApiArgs,
} from "../../src/utils/pluginPaths.js";

function createSettings() {
	return {
		...DEFAULT_SETTINGS,
		mcpArgs: [],
		indexerArgs: [],
		pythonApiArgs: [],
	};
}

describe("pluginPaths Python runtime resolution", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs.map(async (dir) => {
				await fs.rm(dir, { recursive: true, force: true });
			}),
		);
		tempDirs.length = 0;
	});

	it("prefers the bundled apps/api runner for MCP, indexer, and Python backend", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-plugin-paths-"));
		tempDirs.push(root);
		const pluginDir = path.join(root, "vault", ".obsidian", "plugins", "ailss-obsidian");
		const bundledApiDir = path.join(pluginDir, "ailss-service", "apps", "api");
		await fs.mkdir(bundledApiDir, { recursive: true });

		const settings = createSettings();
		expect(resolveMcpArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			bundledApiDir,
			"ailss-mcp-http",
		]);
		expect(resolveMcpHttpArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			bundledApiDir,
			"ailss-mcp-http",
		]);
		expect(resolveIndexerArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			bundledApiDir,
			"ailss-indexer",
		]);
		expect(resolvePythonApiArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			bundledApiDir,
			"ailss-api",
		]);
	});

	it("falls back to the workspace apps/api runner when no bundled service exists", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-plugin-paths-"));
		tempDirs.push(root);
		const pluginDir = path.join(root, "workspace", "packages", "obsidian-plugin");
		const workspaceApiDir = path.join(root, "workspace", "apps", "api");
		await fs.mkdir(pluginDir, { recursive: true });
		await fs.mkdir(workspaceApiDir, { recursive: true });

		const settings = createSettings();
		expect(resolveMcpHttpArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			workspaceApiDir,
			"ailss-mcp-http",
		]);
		expect(resolveIndexerArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			workspaceApiDir,
			"ailss-indexer",
		]);
		expect(resolvePythonApiArgs({ settings, pluginDirRealpathOrNull: pluginDir })).toEqual([
			"run",
			"--directory",
			workspaceApiDir,
			"ailss-api",
		]);
	});
});
