import { Notice, Plugin, TFile } from "obsidian";

import { registerCommands } from "./commands/registerCommands.js";
import { AutoIndexScheduler } from "./indexer/autoIndexScheduler.js";
import { resetIndexDb, resolveIndexerDbPathForReset } from "./indexer/indexDbReset.js";
import { saveLastIndexerLogToFile as saveLastIndexerLogToFileInVault } from "./indexer/indexerLogFile.js";
import { IndexerRunner, type AilssIndexerStatusSnapshot } from "./indexer/indexerRunner.js";
import { McpHttpServiceController } from "./mcp/mcpHttpServiceController.js";
import type { AilssSemanticSearchHit } from "./mcp/ailssMcpClient.js";
import type { AilssMcpHttpServiceStatusSnapshot } from "./mcp/mcpHttpServiceTypes.js";
import { semanticSearchWithMcp } from "./mcp/semanticSearchService.js";
import { normalizeAilssPluginDataV1, parseAilssPluginData } from "./persistence/pluginData.js";
import {
	AilssObsidianSettingTab,
	DEFAULT_SETTINGS,
	type AilssObsidianSettings,
} from "./settings.js";
import { ConfirmModal } from "./ui/confirmModal.js";
import { AilssIndexerLogModal } from "./ui/indexerLogModal.js";
import { AilssIndexerStatusModal } from "./ui/indexerStatusModal.js";
import { AilssMcpStatusModal } from "./ui/mcpStatusModal.js";
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
	resolveMcpArgs,
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
		onStatusChanged: () => this.updateMcpStatusBar(),
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
		onSnapshot: (snapshot) => this.updateStatusBar(snapshot),
	});

	private readonly autoIndex = new AutoIndexScheduler({
		getSettings: () => this.settings,
		isIndexerRunning: () => this.indexer.isRunning(),
		runIndexer: async (paths) => {
			await this.indexer.run(paths);
		},
		onError: (message) => {
			new Notice(`AILSS auto-index failed: ${message}`);
		},
	});

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.ensureMcpHttpServiceToken();

		this.registerIndexerStatusUi();
		this.registerMcpStatusUi();
		this.addSettingTab(new AilssObsidianSettingTab(this.app, this));
		registerCommands(this);
		this.registerAutoIndexEvents();

		if (this.settings.mcpHttpServiceEnabled) {
			await this.startMcpHttpService();
		}

		this.indexer.emitNow();
		this.updateMcpStatusBar();
	}

	async onunload(): Promise<void> {
		await this.stopMcpHttpService();
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
			new Notice("Missing MCP service token. Generate a token first.");
			return;
		}

		try {
			await copyCodexMcpConfigBlockToClipboardImpl({
				url: this.getMcpHttpServiceUrl(),
				token,
			});
			new Notice("Copied Codex MCP config block.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Copy failed: ${message}`);
		}
	}

	async copyCodexPrometheusAgentPromptToClipboard(): Promise<void> {
		try {
			await copyCodexPrometheusAgentPromptToClipboardImpl();
			new Notice("Copied Prometheus Agent skill.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Copy failed: ${message}`);
		}
	}

	async regenerateMcpHttpServiceToken(): Promise<void> {
		this.settings.mcpHttpServiceToken = generateToken();
		await this.saveSettings();
		new Notice("Generated a new MCP service token.");

		if (this.settings.mcpHttpServiceEnabled) {
			await this.restartMcpHttpService();
		}
	}

	async installVaultRootPrompt(options: { kind: PromptKind; overwrite: boolean }): Promise<void> {
		const result = await installVaultRootPromptAtVaultRoot(this.app.vault.adapter, options);
		if (result.status === "exists") {
			new Notice(
				`${result.fileName} already exists at the vault root. Enable overwrite to replace it.`,
			);
			return;
		}

		new Notice(`Installed ${result.fileName} at the vault root.`);
	}

	async startMcpHttpService(): Promise<void> {
		try {
			await this.ensureMcpHttpServiceToken();
			await this.mcpHttpService.start();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.mcpHttpService.recordError(message);
			new Notice(`AILSS MCP service failed: ${message}`);
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

	async reindexVault(): Promise<void> {
		const vaultPath = getVaultPath(this.app);
		if (this.indexer.isRunning()) {
			new Notice("AILSS indexing is already running.");
			this.openIndexerStatusModal();
			return;
		}

		this.autoIndex.reset();

		this.openIndexerStatusModal();
		new Notice("AILSS indexing started…");
		try {
			await this.indexer.run();
			new Notice(`AILSS indexing complete. (${vaultPath})`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const hint = this.describeIndexerFailureHint(message);
			new Notice(`AILSS indexing failed: ${message}${hint ? `\n\n${hint}` : ""}`);
		}
	}

	async semanticSearch(query: string): Promise<AilssSemanticSearchHit[]> {
		return semanticSearchWithMcp(
			{
				getSettings: () => this.settings,
				getVaultPath: () => getVaultPath(this.app),
				getPluginDirRealpathOrNull: () =>
					getPluginDirRealpathOrNull(this.app, this.manifest.id),
				resolveMcpArgs: () =>
					resolveMcpArgs({
						settings: this.settings,
						pluginDirRealpathOrNull: getPluginDirRealpathOrNull(
							this.app,
							this.manifest.id,
						),
					}),
			},
			query,
		);
	}

	openLastIndexerLogModal(): void {
		new AilssIndexerLogModal(this.app, this).open();
	}

	openIndexerStatusModal(): void {
		new AilssIndexerStatusModal(this.app, this).open();
	}

	openMcpStatusModal(): void {
		new AilssMcpStatusModal(this.app, this).open();
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
		if (this.indexer.isRunning()) {
			new Notice("AILSS indexing is currently running.");
			return;
		}

		const pluginDirRealpathOrNull = getPluginDirRealpathOrNull(this.app, this.manifest.id);
		const dbPath = resolveIndexerDbPathForReset({
			vaultPath: getVaultPath(this.app),
			pluginDirRealpathOrNull,
			indexerArgs: resolveIndexerArgs({
				settings: this.settings,
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

		new ConfirmModal(this.app, {
			title: "Reset AILSS index DB",
			message,
			confirmText: options.reindexAfter ? "Reset and reindex" : "Reset",
			onConfirm: async () => {
				const deletedCount = await resetIndexDb({
					dbPath,
					clearIndexerHistory: () => this.indexer.clearHistory(),
					saveSettings: async () => {
						await this.saveSettings();
					},
				});
				new Notice(
					deletedCount > 0
						? `AILSS index DB reset. (deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"})`
						: "No index DB files found to delete.",
				);
				if (options.reindexAfter) {
					await this.reindexVault();
				}
			},
		}).open();
	}

	private registerAutoIndexEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", (file: unknown) => {
				if (!(file instanceof TFile)) return;
				this.autoIndex.enqueue(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("modify", (file: unknown) => {
				if (!(file instanceof TFile)) return;
				this.autoIndex.enqueue(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: unknown) => {
				if (!(file instanceof TFile)) return;
				this.autoIndex.enqueue(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: unknown, oldPath: unknown) => {
				if (!(file instanceof TFile)) return;
				if (typeof oldPath === "string") this.autoIndex.enqueue(oldPath);
				this.autoIndex.enqueue(file.path);
			}),
		);

		this.register(() => this.autoIndex.dispose());
	}

	private describeIndexerFailureHint(message: string): string | null {
		const msg = message.toLowerCase();

		if (msg.includes("sqlite_cantopen") || msg.includes("unable to open database file")) {
			return "SQLite DB open failed: ensure <vault>/.ailss/ is writable and not locked. Fix: Settings → AILSS Obsidian → Index maintenance → Reset index DB (then reindex).";
		}

		if (msg.includes("dimension mismatch") && msg.includes("embedding")) {
			return "Embedding model mismatch: reset the index DB (Settings → AILSS Obsidian → Index maintenance) or switch the embedding model back to the one used when the DB was created.";
		}

		if (msg.includes("missed comma between flow collection entries")) {
			return 'YAML frontmatter parse error: if you have unquoted Obsidian wikilinks in frontmatter lists (e.g. `- [[Some Note]]`), quote them: `- "[[Some Note]]"`. Use the indexer log to see which file was being indexed.';
		}

		return null;
	}

	getIndexerStatusSnapshot(): AilssIndexerStatusSnapshot {
		return this.indexer.getStatusSnapshot();
	}

	subscribeIndexerStatus(listener: (snapshot: AilssIndexerStatusSnapshot) => void): () => void {
		return this.indexer.subscribe(listener);
	}

	private registerIndexerStatusUi(): void {
		const el = this.addStatusBarItem();
		this.statusBarEl = el;
		el.addClass("ailss-obsidian-statusbar");
		el.setAttribute("role", "button");
		el.addEventListener("click", () => this.openIndexerStatusModal());
		this.register(() => el.remove());
	}

	private registerMcpStatusUi(): void {
		const el = this.addStatusBarItem();
		this.mcpStatusBarEl = el;
		el.addClass("ailss-obsidian-mcp-statusbar");
		el.setAttribute("role", "button");
		el.addEventListener("click", () => this.openMcpStatusModal());
		this.register(() => el.remove());
		this.updateMcpStatusBar();
	}

	private updateMcpStatusBar(): void {
		const el = this.mcpStatusBarEl;
		if (!el) return;

		el.removeClass("is-running");
		el.removeClass("is-error");

		if (!this.settings.mcpHttpServiceEnabled) {
			el.textContent = "AILSS: MCP Off";
			el.setAttribute("title", "AILSS MCP service is disabled.");
			return;
		}

		if (this.mcpHttpService.isRunning()) {
			el.textContent = "AILSS: MCP Running";
			el.addClass("is-running");
			el.setAttribute(
				"title",
				["AILSS MCP service running", this.getMcpHttpServiceUrl()].join("\n"),
			);
			return;
		}

		const errorMessage = this.mcpHttpService.getLastErrorMessage();
		if (errorMessage) {
			el.textContent = "AILSS: MCP Error";
			el.addClass("is-error");
			el.setAttribute("title", ["AILSS MCP service error", errorMessage].join("\n"));
			return;
		}

		el.textContent = "AILSS: MCP Stopped";
		const lastStoppedAtRaw = this.mcpHttpService.getLastStoppedAt();
		const lastStoppedAt = formatAilssTimestampForUi(lastStoppedAtRaw);
		el.setAttribute(
			"title",
			[
				"AILSS MCP service stopped",
				lastStoppedAt ? `Last stopped: ${lastStoppedAt}` : "",
				this.getMcpHttpServiceUrl(),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	private updateStatusBar(snapshot: AilssIndexerStatusSnapshot): void {
		const el = this.statusBarEl;
		if (!el) return;

		el.removeClass("is-running");
		el.removeClass("is-error");

		if (snapshot.running) {
			const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
			const total = snapshot.progress.filesTotal;
			const done = snapshot.progress.filesProcessed;
			const suffix = total ? ` ${Math.min(done, total)}/${total}` : "";
			el.textContent = `AILSS: Indexing${suffix}`;
			el.addClass("is-running");
			el.setAttribute(
				"title",
				[
					"AILSS indexing in progress",
					snapshot.progress.currentFile
						? `Current: ${snapshot.progress.currentFile}`
						: "",
					lastSuccessAt ? `Last success: ${lastSuccessAt}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			);
			return;
		}

		if (snapshot.lastErrorMessage) {
			const lastFinishedAt = formatAilssTimestampForUi(snapshot.lastFinishedAt);
			const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
			el.textContent = "AILSS: Index error";
			el.addClass("is-error");
			el.setAttribute(
				"title",
				[
					"AILSS indexing error",
					lastFinishedAt ? `Last attempt: ${lastFinishedAt}` : "",
					lastSuccessAt ? `Last success: ${lastSuccessAt}` : "",
					snapshot.lastErrorMessage,
				]
					.filter(Boolean)
					.join("\n"),
			);
			return;
		}

		if (snapshot.lastSuccessAt) {
			const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
			el.textContent = "AILSS: Ready";
			el.setAttribute("title", `Last success: ${lastSuccessAt ?? snapshot.lastSuccessAt}`);
			return;
		}

		el.textContent = "AILSS: Not indexed";
		el.setAttribute("title", "No successful index run recorded yet.");
	}
}
