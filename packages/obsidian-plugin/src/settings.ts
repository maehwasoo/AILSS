import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type AilssObsidianPlugin from "./main.js";
import { type PromptKind } from "./utils/promptTemplates.js";

export interface AilssObsidianSettings {
	mcpOnlyMode: boolean;
	openaiApiKey: string;
	openaiEmbeddingModel: string;
	topK: number;
	mcpCommand: string;
	mcpArgs: string[];
	mcpHttpServiceEnabled: boolean;
	mcpHttpServicePort: number;
	mcpHttpServiceToken: string;
	mcpHttpServiceShutdownToken: string;
	mcpHttpServiceEnableWriteTools: boolean;
	indexerCommand: string;
	indexerArgs: string[];
	autoIndexEnabled: boolean;
	autoIndexDebounceMs: number;
}

export const DEFAULT_SETTINGS: AilssObsidianSettings = {
	mcpOnlyMode: false,
	openaiApiKey: "",
	openaiEmbeddingModel: "text-embedding-3-large",
	topK: 10,
	mcpCommand: "node",
	mcpArgs: [],
	mcpHttpServiceEnabled: false,
	mcpHttpServicePort: 31415,
	mcpHttpServiceToken: "",
	mcpHttpServiceShutdownToken: "",
	mcpHttpServiceEnableWriteTools: false,
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

		containerEl.createEl("h3", { text: "UI mode" });

		new Setting(containerEl)
			.setName("MCP-only mode")
			.setDesc(
				[
					"Hides Obsidian semantic search UI/commands and focuses on MCP service + indexing.",
					"Note: commands and ribbon icons require an Obsidian reload (or disable/enable the plugin) to fully apply.",
				].join("\n"),
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.mcpOnlyMode);
				toggle.onChange(async (value) => {
					this.plugin.settings.mcpOnlyMode = value;
					await this.plugin.saveSettings();
					new Notice(
						"Saved. Reload Obsidian (or disable/enable the plugin) to fully apply MCP-only mode.",
					);
					this.display();
				});
			});

		containerEl.createEl("h3", { text: "Prompt installer (vault root)" });

		let selectedKind: PromptKind = "AGENTS";
		let overwrite = false;

		new Setting(containerEl)
			.setName("Prompt file")
			.setDesc("Select which prompt file to write at the vault root.")
			.addDropdown((dropdown) => {
				dropdown.addOption("AGENTS", "AGENTS.md");
				dropdown.addOption("CLAUDE", "CLAUDE.md");
				dropdown.addOption("GEMINI", "GEMINI.md");
				dropdown.setValue(selectedKind);
				dropdown.onChange((value) => {
					selectedKind = value as PromptKind;
				});
			});

		new Setting(containerEl)
			.setName("Overwrite existing")
			.setDesc("If enabled, overwrites an existing prompt file at the vault root.")
			.addToggle((toggle) => {
				toggle.setValue(overwrite);
				toggle.onChange((value) => {
					overwrite = value;
				});
			});

		new Setting(containerEl)
			.setName("Install prompt")
			.setDesc(
				[
					"Writes a prompt file at the vault root. These files are meant to steer assistants to use AILSS MCP tools and follow your vault rules.",
					"Note: prompt contents are bundled at build time; changes require plugin rebuild + reload.",
				].join("\n"),
			)
			.addButton((button) => {
				button.setButtonText("Install");
				button.setCta();
				button.onClick(() => {
					void this.plugin.installVaultRootPrompt({
						kind: selectedKind,
						overwrite,
					});
				});
			});

		new Setting(containerEl)
			.setName("Copy Prometheus Agent skill (Codex)")
			.setDesc(
				[
					"Copies a Codex CLI skill snapshot to your clipboard so you can install it under your Codex skills folder.",
					"Recommended install path: ~/.codex/skills/ailss-prometheus-agent/SKILL.md",
					"Note: skill contents are bundled at build time; changes require plugin rebuild + reload.",
				].join("\n"),
			)
			.addButton((button) => {
				button.setButtonText("Copy");
				button.onClick(() => {
					void this.plugin.copyCodexPrometheusAgentPromptToClipboard();
				});
			});

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

		if (!this.plugin.settings.mcpOnlyMode) {
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
		}

		containerEl.createEl("h3", { text: "MCP service (Codex, localhost)" });

		new Setting(containerEl)
			.setName("Enable service")
			.setDesc(
				`${this.plugin.getMcpHttpServiceStatusLine()}\n\nRuns a localhost MCP server for Codex to connect to (URL + token).`,
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.mcpHttpServiceEnabled);
				toggle.onChange(async (value) => {
					this.plugin.settings.mcpHttpServiceEnabled = value;
					await this.plugin.saveSettings();
					if (value) {
						await this.plugin.startMcpHttpService();
					} else {
						await this.plugin.stopMcpHttpService();
					}
				});
			});

		new Setting(containerEl)
			.setName("Port")
			.setDesc("Localhost port for the MCP service (recommended: 31415).")
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_SETTINGS.mcpHttpServicePort));
				text.setValue(String(this.plugin.settings.mcpHttpServicePort));
				text.onChange(async (value) => {
					const parsed = Number(value);
					this.plugin.settings.mcpHttpServicePort = Number.isFinite(parsed)
						? Math.floor(parsed)
						: DEFAULT_SETTINGS.mcpHttpServicePort;
					await this.plugin.saveSettings();
					if (this.plugin.settings.mcpHttpServiceEnabled) {
						await this.plugin.restartMcpHttpService();
					}
				});
			});

		new Setting(containerEl)
			.setName("Enable write tools over MCP")
			.setDesc("Allows Codex to call write tools like edit_note (still requires apply=true).")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.mcpHttpServiceEnableWriteTools);
				toggle.onChange(async (value) => {
					this.plugin.settings.mcpHttpServiceEnableWriteTools = value;
					await this.plugin.saveSettings();
					if (this.plugin.settings.mcpHttpServiceEnabled) {
						await this.plugin.restartMcpHttpService();
					}
				});
			});

		new Setting(containerEl)
			.setName("Token")
			.setDesc(
				"Bearer token required by the localhost service (stored in Obsidian settings).",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("(auto-generated)");
				text.setValue(this.plugin.settings.mcpHttpServiceToken);
				text.onChange(async (value) => {
					this.plugin.settings.mcpHttpServiceToken = value.trim();
					await this.plugin.saveSettings();
					if (this.plugin.settings.mcpHttpServiceEnabled) {
						await this.plugin.restartMcpHttpService();
					}
				});
			})
			.addButton((button) => {
				button.setButtonText("Regenerate");
				button.setWarning();
				button.onClick(() => void this.plugin.regenerateMcpHttpServiceToken());
			});

		new Setting(containerEl)
			.setName("Codex config")
			.setDesc(
				"Copies a ready-to-paste ~/.codex/config.toml block for connecting to this service.",
			)
			.addButton((button) => {
				button.setButtonText("Copy config block");
				button.onClick(() => void this.plugin.copyCodexMcpConfigBlockToClipboard());
			})
			.addButton((button) => {
				button.setButtonText("Restart service");
				button.onClick(() => void this.plugin.restartMcpHttpService());
			});

		containerEl.createEl("h3", { text: "Index maintenance" });

		new Setting(containerEl)
			.setName("Reindex now")
			.setDesc("Runs the indexer immediately (costs money if embeddings are needed).")
			.addButton((button) => {
				button.setButtonText("Reindex vault");
				button.onClick(() => void this.plugin.reindexVault());
			});

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

		containerEl.createEl("h3", { text: "Advanced (spawn overrides)" });

		const details = containerEl.createEl("details");
		details.createEl("summary", {
			text: "Show advanced settings (server/indexer command + args)",
		});
		const advancedContainer = details.createDiv();

		advancedContainer.createEl("h4", { text: "MCP server (local)" });

		new Setting(advancedContainer)
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

		new Setting(advancedContainer)
			.setName("Arguments (one per line)")
			.setDesc(
				[
					"Optional script path override for the MCP server.",
					"Leave empty to use the bundled service (release zip) when available.",
					'Example: "/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js" (for command "node").',
				].join("\n"),
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

		advancedContainer.createEl("h4", { text: "Indexer (local)" });

		new Setting(advancedContainer)
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

		new Setting(advancedContainer)
			.setName("Arguments (one per line)")
			.setDesc(
				[
					"Optional script path override for the indexer.",
					"Leave empty to use the bundled service (release zip) when available.",
					'Example: "/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js" (for command "node").',
				].join("\n"),
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
	}
}
