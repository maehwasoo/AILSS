import type AilssObsidianPlugin from "../main.js";

export function registerCommands(plugin: AilssObsidianPlugin): void {
	plugin.addCommand({
		id: "reindex-vault",
		name: "AILSS: Reindex vault",
		callback: () => void plugin.reindexVault(),
	});

	plugin.addCommand({
		id: "indexing-status",
		name: "AILSS: Indexing status",
		callback: () => plugin.openIndexerStatusModal(),
	});

	plugin.addCommand({
		id: "install-selected-codex-skill",
		name: "AILSS: Install selected Codex skill",
		callback: () => void plugin.installSelectedCodexSkill(),
	});
}
