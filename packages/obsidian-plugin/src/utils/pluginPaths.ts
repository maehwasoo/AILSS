import { FileSystemAdapter, type Plugin } from "obsidian";
import fs from "node:fs";
import path from "node:path";

import type { AilssObsidianSettings } from "../settings.js";
import { replaceBasename } from "./misc.js";

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

export function resolveMcpArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.mcpArgs.length > 0) return options.settings.mcpArgs;
	if (!options.pluginDirRealpathOrNull) return [];

	const bundled = path.resolve(
		options.pluginDirRealpathOrNull,
		"ailss-service/packages/mcp/dist/stdio.js",
	);
	if (fs.existsSync(bundled)) return [bundled];

	const candidate = path.resolve(options.pluginDirRealpathOrNull, "../mcp/dist/stdio.js");
	if (!fs.existsSync(candidate)) return [];

	return [candidate];
}

export function resolveMcpHttpArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	const base = resolveMcpArgs(options);
	const first = base[0];
	if (typeof first === "string" && first.trim()) {
		const resolvedFirst = resolvePathFromPluginDir({
			pluginDirRealpathOrNull: options.pluginDirRealpathOrNull,
			maybePath: first,
		});
		const candidate = replaceBasename(resolvedFirst, "stdio.js", "http.js");
		if (candidate && fs.existsSync(candidate)) {
			return [candidate, ...base.slice(1)];
		}
	}

	if (!options.pluginDirRealpathOrNull) return [];

	const candidate = path.resolve(options.pluginDirRealpathOrNull, "../mcp/dist/http.js");
	if (!fs.existsSync(candidate)) return [];

	return [candidate];
}

export function resolveIndexerArgs(options: {
	settings: AilssObsidianSettings;
	pluginDirRealpathOrNull: string | null;
}): string[] {
	if (options.settings.indexerArgs.length > 0) return options.settings.indexerArgs;
	if (!options.pluginDirRealpathOrNull) return [];

	const bundled = path.resolve(
		options.pluginDirRealpathOrNull,
		"ailss-service/packages/indexer/dist/cli.js",
	);
	if (fs.existsSync(bundled)) return [bundled];

	const candidate = path.resolve(options.pluginDirRealpathOrNull, "../indexer/dist/cli.js");
	if (!fs.existsSync(candidate)) return [];

	return [candidate];
}
