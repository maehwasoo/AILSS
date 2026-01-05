import type AilssObsidianPlugin from "../main.js";
import { AilssSemanticSearchModal } from "../ui/semanticSearchModal.js";

export function registerCommands(plugin: AilssObsidianPlugin): void {
	plugin.addCommand({
		id: "semantic-search",
		name: "AILSS: Semantic search",
		callback: () => {
			new AilssSemanticSearchModal(plugin.app, plugin).open();
		},
	});

	plugin.addCommand({
		id: "reindex-vault",
		name: "AILSS: Reindex vault",
		callback: () => void plugin.reindexVault(),
	});

	plugin.addRibbonIcon("search", "AILSS semantic search", () => {
		new AilssSemanticSearchModal(plugin.app, plugin).open();
	});
}
