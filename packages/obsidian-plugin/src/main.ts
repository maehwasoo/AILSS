import { Plugin } from "obsidian";

import { registerCommands } from "./commands/registerCommands.js";
import { AutoIndexScheduler } from "./indexer/autoIndexScheduler.js";
import { registerAutoIndexEvents } from "./indexer/autoIndexEvents.js";
import { saveLastIndexerLogToFile as saveLastIndexerLogToFileInVault } from "./indexer/indexerLogFile.js";
import { getIndexerFailureHint } from "./indexer/indexerFailureHints.js";
import { IndexerRunner, type AilssIndexerStatusSnapshot } from "./indexer/indexerRunner.js";
import { McpHttpServiceController } from "./mcp/mcpHttpServiceController.js";
import type { AilssMcpHttpServiceStatusSnapshot } from "./mcp/mcpHttpServiceTypes.js";
import { normalizeAilssPluginDataV1, parseAilssPluginData } from "./persistence/pluginData.js";
import {
	AilssObsidianSettingTab,
	DEFAULT_SETTINGS,
	type AilssObsidianSettings,
} from "./settings.js";
import { openResetIndexDbConfirmModal } from "./ui/indexDbResetFlow.js";
import {
	openIndexerStatusModal as openIndexerStatusModalUi,
	openLastIndexerLogModal as openLastIndexerLogModalUi,
	openMcpStatusModal as openMcpStatusModalUi,
} from "./ui/pluginModals.js";
import { showErrorNotice, showNotice } from "./ui/pluginNotices.js";
import {
	mountIndexerStatusBar,
	mountMcpStatusBar,
	renderIndexerStatusBar,
	renderMcpStatusBar,
} from "./ui/statusBars.js";
import { clampPort } from "./utils/clamp.js";
import {
	buildCodexMcpConfigBlock,
	copyCodexMcpConfigBlockToClipboard as copyCodexMcpConfigBlockToClipboardImpl,
	copyCodexPrometheusAgentPromptToClipboard as copyCodexPrometheusAgentPromptToClipboardImpl,
} from "./utils/codexClipboardService.js";
import { formatAilssTimestampForUi } from "./utils/dateTime.js";
import { generateToken } from "./utils/misc.js";
import {
	getPluginDirRealpathOrNull,
	getVaultPath,
	resolveIndexerArgs,
	resolveMcpHttpArgs,
} from "./utils/pluginPaths.js";
import { type PromptKind } from "./utils/promptTemplates.js";
import { installVaultRootPromptAtVaultRoot } from "./utils/vaultRootPromptInstaller.js";

export type { AilssIndexerStatusSnapshot } from "./indexer/indexerRunner.js";
export type { AilssMcpHttpServiceStatusSnapshot } from "./mcp/mcpHttpServiceTypes.js";

export default class AilssObsidianPlugin extends Plugin {
	settings!: AilssObsidianSettings;

	private statusBarEl: HTMLElement | null = null;
	private mcpStatusBarEl: HTMLElement | null = null;

	private readonly mcpHttpService = new McpHttpServiceController({
		getSettings: () => this.settings,
		saveSettings: async () => {
			await this.saveSettings();
		},
		getVaultPath: () => getVaultPath(this.app),
		getPluginDirRealpathOrNull: () => getPluginDirRealpathOrNull(this.app, this.manifest.id),
		resolveMcpHttpArgs: () =>
			resolveMcpHttpArgs({
				settings: this.settings,
				pluginDirRealpathOrNull: getPluginDirRealpathOrNull(this.app, this.manifest.id),
			}),
		getUrl: () => this.getMcpHttpServiceUrl(),
		onStatusChanged: () => {
			if (!this.mcpStatusBarEl) return;
			renderMcpStatusBar(this.mcpStatusBarEl, this.getMcpHttpServiceStatusSnapshot());
		},
	});

	private readonly indexer = new IndexerRunner({
		getSettings: () => this.settings,
		saveSettings: async () => {
			await this.saveSettings();
		},
		getVaultPath: () => getVaultPath(this.app),
		getPluginDirRealpathOrNull: () => getPluginDirRealpathOrNull(this.app, this.manifest.id),
		resolveIndexerArgs: () =>
			resolveIndexerArgs({
				settings: this.settings,
				pluginDirRealpathOrNull: getPluginDirRealpathOrNull(this.app, this.manifest.id),
			}),
		onSnapshot: (snapshot) => {
			if (!this.statusBarEl) return;
			renderIndexerStatusBar(this.statusBarEl, snapshot);
		},
	});

	private readonly autoIndex = new AutoIndexScheduler({
		getSettings: () => this.settings,
		isIndexerRunning: () => this.indexer.isRunning(),
		runIndexer: async (paths) => {
			await this.indexer.run(paths);
		},
		onError: (message) => {
			showNotice(`AILSS auto-index failed: ${message}`);
		},
	});

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.ensureMcpHttpServiceToken();
		await this.ensureMcpHttpServiceShutdownToken();

		this.statusBarEl = mountIndexerStatusBar(this, {
			onClick: () => this.openIndexerStatusModal(),
		});
		this.mcpStatusBarEl = mountMcpStatusBar(this, {
			onClick: () => this.openMcpStatusModal(),
		});
		renderMcpStatusBar(this.mcpStatusBarEl, this.getMcpHttpServiceStatusSnapshot());

		this.addSettingTab(new AilssObsidianSettingTab(this.app, this));
		registerCommands(this);
		registerAutoIndexEvents(this, this.autoIndex);

		if (this.settings.mcpHttpServiceEnabled) {
			await this.startMcpHttpService();
		}

		this.indexer.emitNow();
		renderMcpStatusBar(this.mcpStatusBarEl, this.getMcpHttpServiceStatusSnapshot());
	}

	onunload(): void {
		void this.stopMcpHttpService().catch((error) => {
			console.error("AILSS MCP service stop failed", error);
		});
	}

	async loadSettings(): Promise<void> {
		const parsed = parseAilssPluginData(await this.loadData());
		this.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings);
		this.indexer.setLastSuccessAt(parsed.indexer.lastSuccessAt);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(
			normalizeAilssPluginDataV1({
				version: 1,
				settings: this.settings,
				indexer: { lastSuccessAt: this.indexer.getLastSuccessAt() },
			}),
		);
	}

	getMcpHttpServiceUrl(): string {
		const port = clampPort(this.settings.mcpHttpServicePort);
		return `http://127.0.0.1:${port}/mcp`;
	}

	getMcpHttpServiceStatusSnapshot(): AilssMcpHttpServiceStatusSnapshot {
		return {
			enabled: this.settings.mcpHttpServiceEnabled,
			url: this.getMcpHttpServiceUrl(),
			running: this.mcpHttpService.isRunning(),
			startedAt: this.mcpHttpService.getStartedAt(),
			lastExitCode: this.mcpHttpService.getLastExitCode(),
			lastStoppedAt: this.mcpHttpService.getLastStoppedAt(),
			lastErrorMessage: this.mcpHttpService.getLastErrorMessage(),
		};
	}

	getMcpHttpServiceStatusLine(): string {
		if (this.mcpHttpService.isRunning()) {
			return `Status: Running (${this.getMcpHttpServiceUrl()})`;
		}

		const errorMessage = this.mcpHttpService.getLastErrorMessage();
		if (errorMessage) {
			return `Status: Error\n${errorMessage}`;
		}

		const lastStoppedAtRaw = this.mcpHttpService.getLastStoppedAt();
		if (lastStoppedAtRaw) {
			const lastStoppedAt = formatAilssTimestampForUi(lastStoppedAtRaw);
			return `Status: Stopped (last: ${lastStoppedAt ?? lastStoppedAtRaw})`;
		}

		return "Status: Stopped";
	}

	getCodexMcpConfigBlock(): string {
		const url = this.getMcpHttpServiceUrl();
		const token = this.settings.mcpHttpServiceToken.trim();
		return buildCodexMcpConfigBlock({ url, token });
	}

	async copyCodexMcpConfigBlockToClipboard(): Promise<void> {
		const token = this.settings.mcpHttpServiceToken.trim();
		if (!token) {
			showNotice("Missing MCP service token. Generate a token first.");
			return;
		}

		try {
			await copyCodexMcpConfigBlockToClipboardImpl({
				url: this.getMcpHttpServiceUrl(),
				token,
			});
			showNotice("Copied Codex MCP config block.");
		} catch (error) {
			showErrorNotice("Copy failed", error);
		}
	}

	async copyCodexPrometheusAgentPromptToClipboard(): Promise<void> {
		try {
			await copyCodexPrometheusAgentPromptToClipboardImpl();
			showNotice("Copied Prometheus Agent skill.");
		} catch (error) {
			showErrorNotice("Copy failed", error);
		}
	}

	async regenerateMcpHttpServiceToken(): Promise<void> {
		this.settings.mcpHttpServiceToken = generateToken();
		await this.saveSettings();
		showNotice("Generated a new MCP service token.");

		if (this.settings.mcpHttpServiceEnabled) {
			await this.restartMcpHttpService();
		}
	}

	async installVaultRootPrompt(options: { kind: PromptKind; overwrite: boolean }): Promise<void> {
		const result = await installVaultRootPromptAtVaultRoot(this.app.vault.adapter, options);
		if (result.status === "exists") {
			showNotice(
				`${result.fileName} already exists at the vault root. Enable overwrite to replace it.`,
			);
			return;
		}

		showNotice(`Installed ${result.fileName} at the vault root.`);
	}

	async startMcpHttpService(): Promise<void> {
		try {
			await this.ensureMcpHttpServiceToken();
			await this.ensureMcpHttpServiceShutdownToken();
			await this.mcpHttpService.start();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.mcpHttpService.recordError(message);
			showErrorNotice("AILSS MCP service failed", error);
		}
	}

	async stopMcpHttpService(): Promise<void> {
		await this.mcpHttpService.stop();
	}

	async restartMcpHttpService(): Promise<void> {
		await this.mcpHttpService.restart();
	}

	private async ensureMcpHttpServiceToken(): Promise<void> {
		if (this.settings.mcpHttpServiceToken.trim()) return;
		this.settings.mcpHttpServiceToken = generateToken();
		await this.saveSettings();
	}

	private async ensureMcpHttpServiceShutdownToken(): Promise<void> {
		if (this.settings.mcpHttpServiceShutdownToken.trim()) return;
		this.settings.mcpHttpServiceShutdownToken = generateToken();
		await this.saveSettings();
	}

	async reindexVault(): Promise<void> {
		const vaultPath = getVaultPath(this.app);
		if (this.indexer.isRunning()) {
			showNotice("AILSS indexing is already running.");
			this.openIndexerStatusModal();
			return;
		}

		this.autoIndex.reset();

		this.openIndexerStatusModal();
		showNotice("AILSS indexing started…");
		try {
			await this.indexer.run();
			showNotice(`AILSS indexing complete. (${vaultPath})`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const hint = getIndexerFailureHint(message);
			showNotice(`AILSS indexing failed: ${message}${hint ? `\n\n${hint}` : ""}`);
		}
	}

	openLastIndexerLogModal(): void {
		openLastIndexerLogModalUi(this);
	}

	openIndexerStatusModal(): void {
		openIndexerStatusModalUi(this);
	}

	openMcpStatusModal(): void {
		openMcpStatusModalUi(this);
	}

	getLastIndexerLogSnapshot(): {
		log: string | null;
		finishedAt: string | null;
		exitCode: number | null;
	} {
		return this.indexer.getLastLogSnapshot();
	}

	async saveLastIndexerLogToFile(): Promise<string> {
		return saveLastIndexerLogToFileInVault({
			vaultPath: getVaultPath(this.app),
			log: this.indexer.getLastLog() ?? "",
		});
	}

	confirmResetIndexDb(options: { reindexAfter: boolean }): void {
		openResetIndexDbConfirmModal(
			{
				app: this.app,
				manifestId: this.manifest.id,
				getSettings: () => this.settings,
				isIndexerRunning: () => this.indexer.isRunning(),
				clearIndexerHistory: () => this.indexer.clearHistory(),
				saveSettings: async () => {
					await this.saveSettings();
				},
				reindexVault: async () => {
					await this.reindexVault();
				},
			},
			options,
		);
	}

	getIndexerStatusSnapshot(): AilssIndexerStatusSnapshot {
		return this.indexer.getStatusSnapshot();
	}

	subscribeIndexerStatus(listener: (snapshot: AilssIndexerStatusSnapshot) => void): () => void {
		return this.indexer.subscribe(listener);
	}
}
