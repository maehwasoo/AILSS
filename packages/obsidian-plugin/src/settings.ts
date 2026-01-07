import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type AilssObsidianPlugin from "./main.js";

export interface AilssObsidianSettings {
	openaiApiKey: string;
	openaiEmbeddingModel: string;
	topK: number;
	mcpCommand: string;
	mcpArgs: string[];
	indexerCommand: string;
	indexerArgs: string[];
	autoIndexEnabled: boolean;
	autoIndexDebounceMs: number;
}

export const DEFAULT_SETTINGS: AilssObsidianSettings = {
	openaiApiKey: "",
	openaiEmbeddingModel: "text-embedding-3-large",
	topK: 10,
	mcpCommand: "node",
	mcpArgs: [],
	indexerCommand: "node",
	indexerArgs: [],
	autoIndexEnabled: false,
	autoIndexDebounceMs: 5000,
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
			.setDesc("Defaults to text-embedding-3-large.")
			.addDropdown((dropdown) => {
				const supportedModels = [
					"text-embedding-3-large",
					"text-embedding-3-small",
				] as const;

				for (const model of supportedModels) {
					dropdown.addOption(model, model);
				}

				const current =
					this.plugin.settings.openaiEmbeddingModel.trim() ||
					DEFAULT_SETTINGS.openaiEmbeddingModel;
				const isSupported = supportedModels.includes(
					current as (typeof supportedModels)[number],
				);
				if (!isSupported) dropdown.addOption(current, `${current} (custom)`);

				dropdown.setValue(current);

				dropdown.onChange(async (value) => {
					this.plugin.settings.openaiEmbeddingModel = value;
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
			.setDesc(
				"How to launch the AILSS MCP server (stdio). If you see 'spawn node ENOENT', set this to your absolute Node path (run 'which node' on macOS/Linux, or 'where node' on Windows).",
			)
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

		containerEl.createEl("h3", { text: "Indexer (local)" });

		new Setting(containerEl)
			.setName("Command")
			.setDesc(
				"How to launch the AILSS indexer (writes <vault>/.ailss/index.sqlite). If you see 'spawn node ENOENT', set this to your absolute Node path (run 'which node' on macOS/Linux, or 'where node' on Windows).",
			)
			.addText((text) => {
				text.setPlaceholder("node");
				text.setValue(this.plugin.settings.indexerCommand);
				text.onChange(async (value) => {
					this.plugin.settings.indexerCommand =
						value.trim() || DEFAULT_SETTINGS.indexerCommand;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Arguments (one per line)")
			.setDesc(
				'Example: "/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js" (for command "node").',
			)
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.indexerArgs.join("\n"));
				text.onChange(async (value) => {
					this.plugin.settings.indexerArgs = value
						.split("\n")
						.map((line) => line.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h3", { text: "Index maintenance" });

		new Setting(containerEl)
			.setName("Reset index DB")
			.setDesc(
				"Deletes the SQLite DB file used for indexing (and its WAL/SHM files). This does not modify your markdown notes.",
			)
			.addButton((button) => {
				button.setButtonText("Reset");
				button.setWarning();
				button.onClick(() => this.plugin.confirmResetIndexDb({ reindexAfter: false }));
			})
			.addButton((button) => {
				button.setButtonText("Reset and reindex");
				button.setWarning();
				button.onClick(() => this.plugin.confirmResetIndexDb({ reindexAfter: true }));
			});

		new Setting(containerEl)
			.setName("Indexer logs")
			.setDesc(
				"Shows the output from the last indexing run (stdout/stderr). Useful for finding which file failed.",
			)
			.addButton((button) => {
				button.setButtonText("Show logs");
				button.onClick(() => this.plugin.openLastIndexerLogModal());
			})
			.addButton((button) => {
				button.setButtonText("Save log to file");
				button.onClick(() => {
					void this.plugin
						.saveLastIndexerLogToFile()
						.then((filePath) => new Notice(`Saved log: ${filePath}`))
						.catch((error) => {
							const message = error instanceof Error ? error.message : String(error);
							new Notice(`Save failed: ${message}`);
						});
				});
			});

		containerEl.createEl("h3", { text: "Auto indexing (optional)" });

		new Setting(containerEl)
			.setName("Enable auto indexing")
			.setDesc("Runs the indexer in the background when markdown notes change (costs money).")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoIndexEnabled);
				toggle.onChange(async (value) => {
					this.plugin.settings.autoIndexEnabled = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Debounce (ms)")
			.setDesc("Wait time before indexing after changes (recommended: 2000–10000).")
			.addText((text) => {
				text.setPlaceholder("5000");
				text.setValue(String(this.plugin.settings.autoIndexDebounceMs));
				text.onChange(async (value) => {
					const parsed = Number(value);
					this.plugin.settings.autoIndexDebounceMs = Number.isFinite(parsed)
						? parsed
						: DEFAULT_SETTINGS.autoIndexDebounceMs;
					await this.plugin.saveSettings();
				});
			});
	}
}
