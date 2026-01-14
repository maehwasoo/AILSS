import type { App } from "obsidian";

import { resetIndexDb, resolveIndexerDbPathForReset } from "../indexer/indexDbReset.js";
import type { AilssObsidianSettings } from "../settings.js";
import {
	getPluginDirRealpathOrNull,
	getVaultPath,
	resolveIndexerArgs,
} from "../utils/pluginPaths.js";
import { ConfirmModal } from "./confirmModal.js";
import { showNotice } from "./pluginNotices.js";

type ResetIndexDbFlowDeps = {
	app: App;
	manifestId: string;
	getSettings: () => AilssObsidianSettings;
	isIndexerRunning: () => boolean;
	clearIndexerHistory: () => void;
	saveSettings: () => Promise<void>;
	reindexVault: () => Promise<void>;
};

export function openResetIndexDbConfirmModal(
	deps: ResetIndexDbFlowDeps,
	options: { reindexAfter: boolean },
): void {
	if (deps.isIndexerRunning()) {
		showNotice("AILSS indexing is currently running.");
		return;
	}

	const settings = deps.getSettings();
	const pluginDirRealpathOrNull = getPluginDirRealpathOrNull(deps.app, deps.manifestId);
	const dbPath = resolveIndexerDbPathForReset({
		vaultPath: getVaultPath(deps.app),
		pluginDirRealpathOrNull,
		indexerArgs: resolveIndexerArgs({
			settings,
			pluginDirRealpathOrNull,
		}),
	});

	const message = options.reindexAfter
		? [
				"This will delete the AILSS index database and immediately rebuild it.",
				"",
				`DB: ${dbPath}`,
				"(including SQLite sidecar files like -wal/-shm)",
				"",
				"Your Markdown notes are not modified.",
				"Reindexing will call the OpenAI embeddings API (costs money) and may take time depending on vault size.",
			].join("\n")
		: [
				"This will delete the AILSS index database used for AILSS search and recommendations.",
				"",
				`DB: ${dbPath}`,
				"(including SQLite sidecar files like -wal/-shm)",
				"",
				"Your Markdown notes are not modified.",
				"After reset, AILSS search will return no results until you run “AILSS: Reindex vault”.",
				"This will also clear the “Last success” timestamp shown in the status bar until you reindex.",
			].join("\n");

	new ConfirmModal(deps.app, {
		title: "Reset AILSS index DB",
		message,
		confirmText: options.reindexAfter ? "Reset and reindex" : "Reset",
		onConfirm: async () => {
			const deletedCount = await resetIndexDb({
				dbPath,
				clearIndexerHistory: deps.clearIndexerHistory,
				saveSettings: deps.saveSettings,
			});
			showNotice(
				deletedCount > 0
					? `AILSS index DB reset. (deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"})`
					: "No index DB files found to delete.",
			);

			if (options.reindexAfter) {
				await deps.reindexVault();
			}
		},
	}).open();
}
