import { Modal, Notice, Setting } from "obsidian";

import type AilssObsidianPlugin from "../main.js";

export class AilssIndexerLogModal extends Modal {
	constructor(
		app: AilssObsidianPlugin["app"],
		private readonly plugin: AilssObsidianPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ailss-obsidian");

		contentEl.createEl("h2", { text: "AILSS indexer log" });

		const snapshot = this.plugin.getLastIndexerLogSnapshot();
		const metaText = snapshot.finishedAt
			? `Last run: ${snapshot.finishedAt}${snapshot.exitCode === null ? "" : ` (exit ${snapshot.exitCode})`}`
			: "No indexer run recorded yet.";
		contentEl.createDiv({ text: metaText });

		const textarea = contentEl.createEl("textarea");
		textarea.rows = 18;
		textarea.style.width = "100%";
		textarea.style.marginTop = "12px";
		textarea.value = snapshot.log ?? "";
		textarea.readOnly = true;

		new Setting(contentEl)
			.setName("Actions")
			.addButton((button) => {
				button.setButtonText("Copy");
				button.onClick(() => void this.copyToClipboard(textarea.value));
			})
			.addButton((button) => {
				button.setButtonText("Save to file");
				button.onClick(() => void this.saveToFile());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async copyToClipboard(text: string): Promise<void> {
		if (!text.trim()) {
			new Notice("No log to copy.");
			return;
		}

		try {
			await navigator.clipboard.writeText(text);
			new Notice("Copied log to clipboard.");
		} catch {
			new Notice("Copy failed.");
		}
	}

	private async saveToFile(): Promise<void> {
		try {
			const filePath = await this.plugin.saveLastIndexerLogToFile();
			new Notice(`Saved log: ${filePath}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Save failed: ${message}`);
		}
	}
}
