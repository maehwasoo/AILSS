import { Notice, Setting } from "obsidian";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderIndexMaintenanceSection(
	containerEl: HTMLElement,
	{ plugin }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "Index maintenance" });

	new Setting(containerEl)
		.setName("Reindex now")
		.setDesc("Runs the indexer immediately (costs money if embeddings are needed).")
		.addButton((button) => {
			button.setButtonText("Reindex vault");
			button.onClick(() => void plugin.reindexVault());
		});

	new Setting(containerEl)
		.setName("Reset index DB")
		.setDesc(
			"Deletes the SQLite DB file used for indexing (and its WAL/SHM files). This does not modify your markdown notes.",
		)
		.addButton((button) => {
			button.setButtonText("Reset");
			button.setWarning();
			button.onClick(() => plugin.confirmResetIndexDb({ reindexAfter: false }));
		})
		.addButton((button) => {
			button.setButtonText("Reset and reindex");
			button.setWarning();
			button.onClick(() => plugin.confirmResetIndexDb({ reindexAfter: true }));
		});

	new Setting(containerEl)
		.setName("Indexer logs")
		.setDesc(
			"Shows the output from the last indexing run (stdout/stderr). Useful for finding which file failed.",
		)
		.addButton((button) => {
			button.setButtonText("Show logs");
			button.onClick(() => plugin.openLastIndexerLogModal());
		})
		.addButton((button) => {
			button.setButtonText("Save log to file");
			button.onClick(() => {
				void plugin
					.saveLastIndexerLogToFile()
					.then((filePath) => new Notice(`Saved log: ${filePath}`))
					.catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						new Notice(`Save failed: ${message}`);
					});
			});
		});
}
