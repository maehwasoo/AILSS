import { FileSystemAdapter, type Plugin } from "obsidian";
import fs from "node:fs";
import path from "node:path";

import type { AilssObsidianSettings } from "../settings.js";

export function getVaultPath(app: Plugin["app"]): string {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error("Vault adapter is not FileSystemAdapter. This plugin is desktop-only.");
	}

	return adapter.getBasePath();
}

export function getPluginDirRealpathOrNull(app: Plugin["app"], pluginId: string): string | null {
	// Realpath resolution
	// - supports symlink installs during development
	try {
		const vaultPath = getVaultPath(app);
		const configDir = app.vault.configDir;
		const pluginDir = path.join(vaultPath, configDir, "plugins", pluginId);
		return fs.realpathSync(pluginDir);
	} catch {
		return null;
	}
}

export function resolvePathFromPluginDir(options: {
	pluginDirRealpathOrNull: string | null;
	maybePath: string;
}): string {
	const trimmed = options.maybePath.trim();
	if (!trimmed) return trimmed;
	if (path.isAbsolute(trimmed)) return trimmed;

	if (!options.pluginDirRealpathOrNull) return path.resolve(trimmed);
	return path.resolve(options.pluginDirRealpathOrNull, trimmed);
}

function resolveApiAppDir(pluginDirRealpathOrNull: string | null): string | null {
	if (!pluginDirRealpathOrNull) return null;

	const bundled = path.resolve(pluginDirRealpathOrNull, "ailss-service/apps/api");
	if (fs.existsSync(bundled)) return bundled;

	const workspaceCandidate = path.resolve(pluginDirRealpathOrNull, "../../apps/api");
	if (fs.existsSync(workspaceCandidate)) return workspaceCandidate;

	return null;
}

function resolveUvRunnerArgs(pluginDirRealpathOrNull: string | null, entrypoint: string): string[] {
	const apiDir = resolveApiAppDir(pluginDirRealpathOrNull);
	if (!apiDir) return [];
	return ["run", "--directory", apiDir, entrypoint];
}

export function resolveMcpArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.mcpArgs.length > 0) return options.settings.mcpArgs;
	return resolveUvRunnerArgs(options.pluginDirRealpathOrNull, "ailss-mcp-http");
}

export function resolveMcpHttpArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.mcpArgs.length > 0) return options.settings.mcpArgs;
	return resolveUvRunnerArgs(options.pluginDirRealpathOrNull, "ailss-mcp-http");
}

export function resolveIndexerArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.indexerArgs.length > 0) return options.settings.indexerArgs;
	return resolveUvRunnerArgs(options.pluginDirRealpathOrNull, "ailss-indexer");
}

export function resolvePythonApiArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.pythonApiArgs.length > 0) return options.settings.pythonApiArgs;
	return resolveUvRunnerArgs(options.pluginDirRealpathOrNull, "ailss-api");
}
