import { App, PluginSettingTab, Setting } from "obsidian";

import type AilssObsidianPlugin from "./main.js";

export interface AilssObsidianSettings {
	openaiApiKey: string;
	openaiEmbeddingModel: string;
	topK: number;
	mcpCommand: string;
	mcpArgs: string[];
}

export const DEFAULT_SETTINGS: AilssObsidianSettings = {
	openaiApiKey: "",
	openaiEmbeddingModel: "text-embedding-3-small",
	topK: 10,
	mcpCommand: "node",
	mcpArgs: [],
};

export class AilssObsidianSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AilssObsidianPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "AILSS Obsidian" });

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc("Stored locally in Obsidian settings. Required for semantic search.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("sk-…");
				text.setValue(this.plugin.settings.openaiApiKey);
				text.onChange(async (value) => {
					this.plugin.settings.openaiApiKey = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Embedding model")
			.setDesc("Defaults to text-embedding-3-small.")
			.addText((text) => {
				text.setPlaceholder("text-embedding-3-small");
				text.setValue(this.plugin.settings.openaiEmbeddingModel);
				text.onChange(async (value) => {
					this.plugin.settings.openaiEmbeddingModel =
						value.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Top K")
			.setDesc("How many results to return (1–50).")
			.addText((text) => {
				text.setPlaceholder("10");
				text.setValue(String(this.plugin.settings.topK));
				text.onChange(async (value) => {
					const parsed = Number(value);
					this.plugin.settings.topK = Number.isFinite(parsed)
						? parsed
						: DEFAULT_SETTINGS.topK;
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h3", { text: "MCP server (local)" });

		new Setting(containerEl)
			.setName("Command")
			.setDesc("How to launch the AILSS MCP server (stdio).")
			.addText((text) => {
				text.setPlaceholder("node");
				text.setValue(this.plugin.settings.mcpCommand);
				text.onChange(async (value) => {
					this.plugin.settings.mcpCommand = value.trim() || DEFAULT_SETTINGS.mcpCommand;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Arguments (one per line)")
			.setDesc(
				'Example: "/absolute/path/to/Ailss-project/packages/mcp/dist/stdio.js" (for command "node").',
			)
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.mcpArgs.join("\n"));
				text.onChange(async (value) => {
					this.plugin.settings.mcpArgs = value
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				});
			});
	}
}
