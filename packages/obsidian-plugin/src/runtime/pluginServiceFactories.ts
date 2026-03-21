import type { Plugin } from "obsidian";

import { AutoIndexScheduler } from "../indexer/autoIndexScheduler.js";
import { IndexerRunner, type AilssIndexerStatusSnapshot } from "../indexer/indexerRunner.js";
import { McpHttpServiceController } from "../mcp/mcpHttpServiceController.js";
import { PythonApiServiceController } from "../pythonApi/pythonApiServiceController.js";
import type { AilssObsidianSettings } from "../settings.js";
import { showNotice } from "../ui/pluginNotices.js";
import {
	getPluginDirRealpathOrNull,
	getVaultPath,
	resolveIndexerArgs,
	resolveMcpHttpArgs,
	resolvePythonApiArgs,
} from "../utils/pluginPaths.js";

type PluginServiceFactoryOptions = {
	app: Plugin["app"];
	pluginId: string;
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getMcpUrl?: () => string;
	getPythonUrl?: () => string;
	onMcpStatusChanged: () => void;
	onPythonStatusChanged: () => void;
	onIndexerSnapshot: (snapshot: AilssIndexerStatusSnapshot) => void;
};

export function createMcpHttpServiceController(
	options: PluginServiceFactoryOptions,
): McpHttpServiceController {
	return new McpHttpServiceController({
		getSettings: options.getSettings,
		saveSettings: options.saveSettings,
		getVaultPath: () => getVaultPath(options.app),
		getPluginDirRealpathOrNull: () => getPluginDirRealpathOrNull(options.app, options.pluginId),
		resolveMcpHttpArgs: () =>
			resolveMcpHttpArgs({
				settings: options.getSettings(),
				pluginDirRealpathOrNull: getPluginDirRealpathOrNull(options.app, options.pluginId),
			}),
		getUrl: options.getMcpUrl ?? (() => ""),
		onStatusChanged: options.onMcpStatusChanged,
	});
}

export function createPythonApiServiceController(
	options: PluginServiceFactoryOptions,
): PythonApiServiceController {
	return new PythonApiServiceController({
		getSettings: options.getSettings,
		saveSettings: options.saveSettings,
		getVaultPath: () => getVaultPath(options.app),
		getPluginDirRealpathOrNull: () => getPluginDirRealpathOrNull(options.app, options.pluginId),
		resolvePythonApiArgs: () =>
			resolvePythonApiArgs({
				settings: options.getSettings(),
				pluginDirRealpathOrNull: getPluginDirRealpathOrNull(options.app, options.pluginId),
			}),
		getUrl: options.getPythonUrl ?? (() => ""),
		onStatusChanged: options.onPythonStatusChanged,
	});
}

export function createIndexerRunner(options: PluginServiceFactoryOptions): IndexerRunner {
	return new IndexerRunner({
		getSettings: options.getSettings,
		saveSettings: options.saveSettings,
		getVaultPath: () => getVaultPath(options.app),
		getPluginDirRealpathOrNull: () => getPluginDirRealpathOrNull(options.app, options.pluginId),
		resolveIndexerArgs: () =>
			resolveIndexerArgs({
				settings: options.getSettings(),
				pluginDirRealpathOrNull: getPluginDirRealpathOrNull(options.app, options.pluginId),
			}),
		onSnapshot: options.onIndexerSnapshot,
	});
}

export function createAutoIndexScheduler(options: {
	getSettings: () => AilssObsidianSettings;
	isIndexerRunning: () => boolean;
	runIndexer: (paths: string[]) => Promise<void>;
}): AutoIndexScheduler {
	return new AutoIndexScheduler({
		getSettings: options.getSettings,
		isIndexerRunning: options.isIndexerRunning,
		runIndexer: options.runIndexer,
		onError: (message) => {
			showNotice(`AILSS auto-index failed: ${message}`);
		},
	});
}
