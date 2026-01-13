import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import fs from "node:fs";
import path from "node:path";

import { registerCommands } from "./commands/registerCommands.js";
import { AutoIndexScheduler } from "./indexer/autoIndexScheduler.js";
import { IndexerRunner, type AilssIndexerStatusSnapshot } from "./indexer/indexerRunner.js";
import { McpHttpServiceController } from "./mcp/mcpHttpServiceController.js";
import type { AilssSemanticSearchHit } from "./mcp/ailssMcpClient.js";
import { AilssMcpClient } from "./mcp/ailssMcpClient.js";
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
import { clampPort, clampTopK } from "./utils/clamp.js";
import { formatAilssTimestampForUi } from "./utils/dateTime.js";
import { fileExists, generateToken, parseCliArgValue, replaceBasename } from "./utils/misc.js";
import {
	nodeNotFoundMessage,
	resolveSpawnCommandAndEnv,
	toStringEnvRecord,
} from "./utils/spawn.js";
import { codexPrometheusAgentPrompt } from "./utils/codexPrompts.js";
import { type PromptKind, promptFilename, promptTemplate } from "./utils/promptTemplates.js";

export type { AilssIndexerStatusSnapshot } from "./indexer/indexerRunner.js";

export type AilssMcpHttpServiceStatusSnapshot = {
	enabled: boolean;
	url: string;
	running: boolean;
	startedAt: string | null;
	lastExitCode: number | null;
	lastStoppedAt: string | null;
	lastErrorMessage: string | null;
};

export default class AilssObsidianPlugin extends Plugin {
	settings!: AilssObsidianSettings;

	private statusBarEl: HTMLElement | null = null;
	private mcpStatusBarEl: HTMLElement | null = null;

	private readonly mcpHttpService = new McpHttpServiceController({
		getSettings: () => this.settings,
		saveSettings: async () => {
			await this.saveSettings();
		},
		getVaultPath: () => this.getVaultPath(),
		getPluginDirRealpathOrNull: () => this.getPluginDirRealpathOrNull(),
		resolveMcpHttpArgs: () => this.resolveMcpHttpArgs(),
		getUrl: () => this.getMcpHttpServiceUrl(),
		onStatusChanged: () => this.updateMcpStatusBar(),
	});

	private readonly indexer = new IndexerRunner({
		getSettings: () => this.settings,
		saveSettings: async () => {
			await this.saveSettings();
		},
		getVaultPath: () => this.getVaultPath(),
		getPluginDirRealpathOrNull: () => this.getPluginDirRealpathOrNull(),
		resolveIndexerArgs: () => this.resolveIndexerArgs(),
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

		return [
			"[mcp_servers.ailss]",
			`url = ${JSON.stringify(url)}`,
			`http_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`,
			"",
		].join("\n");
	}

	async copyCodexMcpConfigBlockToClipboard(): Promise<void> {
		const token = this.settings.mcpHttpServiceToken.trim();
		if (!token) {
			new Notice("Missing MCP service token. Generate a token first.");
			return;
		}

		try {
			const clipboard = (
				navigator as unknown as { clipboard?: { writeText?: (v: string) => Promise<void> } }
			).clipboard;
			if (!clipboard?.writeText) {
				new Notice("Clipboard not available.");
				return;
			}

			await clipboard.writeText(this.getCodexMcpConfigBlock());
			new Notice("Copied Codex MCP config block.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Copy failed: ${message}`);
		}
	}

	async copyCodexPrometheusAgentPromptToClipboard(): Promise<void> {
		try {
			const clipboard = (
				navigator as unknown as { clipboard?: { writeText?: (v: string) => Promise<void> } }
			).clipboard;
			if (!clipboard?.writeText) {
				new Notice("Clipboard not available.");
				return;
			}

			await clipboard.writeText(codexPrometheusAgentPrompt());
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
		const fileName = promptFilename(options.kind);
		const adapter = this.app.vault.adapter;

		const exists = await adapter.exists(fileName);
		if (exists && !options.overwrite) {
			new Notice(
				`${fileName} already exists at the vault root. Enable overwrite to replace it.`,
			);
			return;
		}

		await adapter.write(fileName, promptTemplate(options.kind));
		new Notice(`Installed ${fileName} at the vault root.`);
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
		const vaultPath = this.getVaultPath();
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
		const vaultPath = this.getVaultPath();
		const openaiApiKey = this.settings.openaiApiKey.trim();
		if (!openaiApiKey) {
			throw new Error(
				"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
			);
		}

		const mcpCommand = this.settings.mcpCommand.trim();
		const mcpArgs = this.resolveMcpArgs();
		if (!mcpCommand || mcpArgs.length === 0) {
			throw new Error(
				"Missing MCP server command/args. Set it in settings (e.g. command=node, args=/abs/path/to/packages/mcp/dist/stdio.js).",
			);
		}

		// Env overrides for the spawned MCP server process
		const env: Record<string, string> = {
			OPENAI_API_KEY: openaiApiKey,
			OPENAI_EMBEDDING_MODEL:
				this.settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
			AILSS_VAULT_PATH: vaultPath,
		};

		const cwd = this.getPluginDirRealpathOrNull();
		const spawnEnv = { ...process.env, ...env };
		const resolved = resolveSpawnCommandAndEnv(mcpCommand, spawnEnv);
		if (resolved.command === "node") {
			throw new Error(nodeNotFoundMessage("MCP"));
		}
		const client = new AilssMcpClient({
			command: resolved.command,
			args: mcpArgs,
			env: toStringEnvRecord(resolved.env),
			...(cwd ? { cwd } : {}),
		});

		try {
			return await client.semanticSearch(query, clampTopK(this.settings.topK));
		} finally {
			await client.close();
		}
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
		const vaultPath = this.getVaultPath();
		const log = this.indexer.getLastLog()?.trim() ?? "";
		if (!log) throw new Error("No indexer log available.");

		const dir = path.join(vaultPath, ".ailss");
		await fs.promises.mkdir(dir, { recursive: true });

		const filePath = path.join(dir, "ailss-indexer-last.log");
		await fs.promises.writeFile(filePath, log + "\n", "utf8");
		return filePath;
	}

	confirmResetIndexDb(options: { reindexAfter: boolean }): void {
		if (this.indexer.isRunning()) {
			new Notice("AILSS indexing is currently running.");
			return;
		}

		const dbPath = this.resolveIndexerDbPathForReset();
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
				const deletedCount = await this.resetIndexDb(dbPath);
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

	private resolveMcpArgs(): string[] {
		if (this.settings.mcpArgs.length > 0) return this.settings.mcpArgs;

		const pluginDir = this.getPluginDirRealpathOrNull();
		if (!pluginDir) return [];

		const candidate = path.resolve(pluginDir, "../mcp/dist/stdio.js");
		if (!fs.existsSync(candidate)) return [];

		return [candidate];
	}

	private resolveMcpHttpArgs(): string[] {
		const base = this.resolveMcpArgs();
		const first = base[0];
		if (typeof first === "string" && first.trim()) {
			const resolvedFirst = this.resolvePathFromPluginDir(first);
			const candidate = replaceBasename(resolvedFirst, "stdio.js", "http.js");
			if (candidate && fs.existsSync(candidate)) {
				return [candidate, ...base.slice(1)];
			}
		}

		const pluginDir = this.getPluginDirRealpathOrNull();
		if (!pluginDir) return [];

		const candidate = path.resolve(pluginDir, "../mcp/dist/http.js");
		if (!fs.existsSync(candidate)) return [];

		return [candidate];
	}

	private resolvePathFromPluginDir(maybePath: string): string {
		const trimmed = maybePath.trim();
		if (!trimmed) return trimmed;
		if (path.isAbsolute(trimmed)) return trimmed;

		const pluginDir = this.getPluginDirRealpathOrNull();
		if (!pluginDir) return path.resolve(trimmed);
		return path.resolve(pluginDir, trimmed);
	}

	private resolveIndexerArgs(): string[] {
		if (this.settings.indexerArgs.length > 0) return this.settings.indexerArgs;

		const pluginDir = this.getPluginDirRealpathOrNull();
		if (!pluginDir) return [];

		const candidate = path.resolve(pluginDir, "../indexer/dist/cli.js");
		if (!fs.existsSync(candidate)) return [];

		return [candidate];
	}

	private getVaultPath(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("Vault adapter is not FileSystemAdapter. This plugin is desktop-only.");
		}

		return adapter.getBasePath();
	}

	private getPluginDirRealpathOrNull(): string | null {
		// Realpath resolution
		// - supports symlink installs during development
		try {
			const vaultPath = this.getVaultPath();
			const configDir = this.app.vault.configDir;
			const pluginDir = path.join(vaultPath, configDir, "plugins", this.manifest.id);
			return fs.realpathSync(pluginDir);
		} catch {
			return null;
		}
	}

	private resolveIndexerDbPathForReset(): string {
		const vaultPath = this.getVaultPath();
		const pluginDir = this.getPluginDirRealpathOrNull();
		const args = this.resolveIndexerArgs();

		const fromArgs = parseCliArgValue(args, "--db");
		if (fromArgs) {
			if (path.isAbsolute(fromArgs)) return fromArgs;
			if (pluginDir) return path.resolve(pluginDir, fromArgs);
			return path.resolve(fromArgs);
		}

		return path.join(vaultPath, ".ailss", "index.sqlite");
	}

	private async resetIndexDb(dbPath: string): Promise<number> {
		const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
		const deletedPaths: string[] = [];

		for (const filePath of candidates) {
			try {
				if (!(await fileExists(filePath))) continue;
				await fs.promises.rm(filePath, { force: true });
				deletedPaths.push(filePath);
			} catch {
				// ignore
			}
		}

		this.indexer.clearHistory();
		await this.saveSettings();

		return deletedPaths.length;
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
