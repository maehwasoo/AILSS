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
		id: "python-backend-health-check",
		name: "AILSS: Check Python backend health",
		callback: () => void plugin.checkPythonApiHealth(),
	});

	plugin.addCommand({
		id: "python-backend-run-eval",
		name: "AILSS: Run Python backend eval",
		callback: () => void plugin.runPythonBackendEval(),
	});
}
