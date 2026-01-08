import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { registerCommands } from "./commands/registerCommands.js";
import type { AilssSemanticSearchHit } from "./mcp/ailssMcpClient.js";
import { AilssMcpClient } from "./mcp/ailssMcpClient.js";
import {
	AilssObsidianSettingTab,
	DEFAULT_SETTINGS,
	type AilssObsidianSettings,
} from "./settings.js";
import { ConfirmModal } from "./ui/confirmModal.js";
import { AilssIndexerLogModal } from "./ui/indexerLogModal.js";
import { AilssIndexerStatusModal } from "./ui/indexerStatusModal.js";
import { clampDebounceMs, clampPort, clampTopK } from "./utils/clamp.js";
import { formatAilssTimestampForUi } from "./utils/dateTime.js";
import {
	appendLimited,
	fileExists,
	formatIndexerLog,
	generateToken,
	nowIso,
	parseCliArgValue,
	replaceBasename,
} from "./utils/misc.js";
import {
	nodeNotFoundMessage,
	resolveSpawnCommandAndEnv,
	spawnAndCapture,
	toStringEnvRecord,
} from "./utils/spawn.js";
import { type PromptKind, promptFilename, promptTemplate } from "./utils/promptTemplates.js";
import { normalizeVaultRelPath, shouldIndexVaultRelPath } from "./utils/vault.js";

export type AilssIndexerStatusSnapshot = {
	running: boolean;
	startedAt: string | null;
	lastSuccessAt: string | null;
	lastFinishedAt: string | null;
	lastExitCode: number | null;
	lastErrorMessage: string | null;
	progress: {
		filesTotal: number | null;
		filesProcessed: number;
		currentFile: string | null;
		currentMode: "index" | "meta" | null;
		chunkCurrent: number | null;
		chunkTotal: number | null;
		summary: { changedFiles: number; indexedChunks: number; deletedFiles: number } | null;
	};
	liveLog: { stdout: string; stderr: string };
};

type AilssObsidianPluginDataV1 = {
	version: 1;
	settings: Partial<AilssObsidianSettings>;
	indexer: {
		lastSuccessAt: string | null;
	};
};

export default class AilssObsidianPlugin extends Plugin {
	settings!: AilssObsidianSettings;

	private statusBarEl: HTMLElement | null = null;
	private indexerStatusListeners = new Set<(snapshot: AilssIndexerStatusSnapshot) => void>();
	private indexerUiUpdateTimer: NodeJS.Timeout | null = null;

	private mcpHttpServiceProc: ChildProcess | null = null;
	private mcpHttpServiceLiveStdout = "";
	private mcpHttpServiceLiveStderr = "";
	private mcpHttpServiceStartedAt: string | null = null;
	private mcpHttpServiceLastExitCode: number | null = null;
	private mcpHttpServiceLastStoppedAt: string | null = null;
	private mcpHttpServiceLastErrorMessage: string | null = null;

	private autoIndexTimer: NodeJS.Timeout | null = null;
	private autoIndexPendingPaths = new Set<string>();
	private autoIndexNeedsRerun = false;
	private indexerRunning = false;
	private lastIndexerLog: string | null = null;
	private lastIndexerFinishedAt: string | null = null;
	private lastIndexerExitCode: number | null = null;
	private lastIndexerErrorMessage: string | null = null;
	private lastIndexerSuccessAt: string | null = null;

	private indexerStartedAt: string | null = null;
	private indexerLiveStdout = "";
	private indexerLiveStderr = "";
	private indexerStdoutRemainder = "";
	private indexerPathLimitedRun = false;
	private indexerFilesTotal: number | null = null;
	private indexerFilesProcessed = 0;
	private indexerCurrentFile: string | null = null;
	private indexerCurrentMode: "index" | "meta" | null = null;
	private indexerChunkCurrent: number | null = null;
	private indexerChunkTotal: number | null = null;
	private indexerSummary: {
		changedFiles: number;
		indexedChunks: number;
		deletedFiles: number;
	} | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.ensureMcpHttpServiceToken();

		this.registerIndexerStatusUi();
		this.addSettingTab(new AilssObsidianSettingTab(this.app, this));
		registerCommands(this);
		this.registerAutoIndexEvents();

		if (this.settings.mcpHttpServiceEnabled) {
			await this.startMcpHttpService();
		}

		this.emitIndexerStatusNow();
	}

	async onunload(): Promise<void> {
		await this.stopMcpHttpService();
	}

	async loadSettings(): Promise<void> {
		const parsed = parseAilssPluginData(await this.loadData());
		this.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings);
		this.lastIndexerSuccessAt = parsed.indexer.lastSuccessAt;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(
			normalizeAilssPluginDataV1({
				version: 1,
				settings: this.settings,
				indexer: { lastSuccessAt: this.lastIndexerSuccessAt },
			}),
		);
	}

	getMcpHttpServiceUrl(): string {
		const port = clampPort(this.settings.mcpHttpServicePort);
		return `http://127.0.0.1:${port}/mcp`;
	}

	getMcpHttpServiceStatusLine(): string {
		if (this.mcpHttpServiceProc) {
			return `Status: Running (${this.getMcpHttpServiceUrl()})`;
		}

		if (this.mcpHttpServiceLastErrorMessage) {
			return `Status: Error\n${this.mcpHttpServiceLastErrorMessage}`;
		}

		if (this.mcpHttpServiceLastStoppedAt) {
			const lastStoppedAt = formatAilssTimestampForUi(this.mcpHttpServiceLastStoppedAt);
			return `Status: Stopped (last: ${lastStoppedAt ?? this.mcpHttpServiceLastStoppedAt})`;
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
		if (this.mcpHttpServiceProc) return;

		try {
			await this.ensureMcpHttpServiceToken();
			const token = this.settings.mcpHttpServiceToken.trim();
			if (!token) {
				throw new Error("Missing MCP service token.");
			}

			const vaultPath = this.getVaultPath();
			const openaiApiKey = this.settings.openaiApiKey.trim();
			if (!openaiApiKey) {
				throw new Error(
					"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
				);
			}

			const mcpCommand = this.settings.mcpCommand.trim();
			const mcpArgs = this.resolveMcpHttpArgs();
			if (!mcpCommand || mcpArgs.length === 0) {
				throw new Error(
					"Missing MCP HTTP server args. Build @ailss/mcp and ensure dist/http.js exists (or configure the MCP server path in settings).",
				);
			}

			const port = clampPort(this.settings.mcpHttpServicePort);
			if (port !== this.settings.mcpHttpServicePort) {
				this.settings.mcpHttpServicePort = port;
				await this.saveSettings();
			}

			const env: Record<string, string> = {
				OPENAI_API_KEY: openaiApiKey,
				OPENAI_EMBEDDING_MODEL:
					this.settings.openaiEmbeddingModel.trim() ||
					DEFAULT_SETTINGS.openaiEmbeddingModel,
				AILSS_VAULT_PATH: vaultPath,
				AILSS_MCP_HTTP_HOST: "127.0.0.1",
				AILSS_MCP_HTTP_PORT: String(port),
				AILSS_MCP_HTTP_PATH: "/mcp",
				AILSS_MCP_HTTP_TOKEN: token,
			};

			if (this.settings.mcpHttpServiceEnableWriteTools) {
				env.AILSS_ENABLE_WRITE_TOOLS = "1";
			}

			const cwd = this.getPluginDirRealpathOrNull();
			const spawnEnv = { ...process.env, ...env };
			const resolved = resolveSpawnCommandAndEnv(mcpCommand, spawnEnv);
			if (resolved.command === "node") {
				throw new Error(nodeNotFoundMessage("MCP"));
			}

			this.mcpHttpServiceLiveStdout = "";
			this.mcpHttpServiceLiveStderr = "";
			this.mcpHttpServiceStartedAt = nowIso();
			this.mcpHttpServiceLastExitCode = null;
			this.mcpHttpServiceLastStoppedAt = null;
			this.mcpHttpServiceLastErrorMessage = null;

			const child = spawn(resolved.command, mcpArgs, {
				stdio: ["ignore", "pipe", "pipe"],
				...(cwd ? { cwd } : {}),
				env: resolved.env,
			});

			this.mcpHttpServiceProc = child;

			child.stdout?.on("data", (chunk: unknown) => {
				const text = typeof chunk === "string" ? chunk : String(chunk);
				this.mcpHttpServiceLiveStdout = appendLimited(
					this.mcpHttpServiceLiveStdout,
					text,
					40_000,
				);
			});

			child.stderr?.on("data", (chunk: unknown) => {
				const text = typeof chunk === "string" ? chunk : String(chunk);
				this.mcpHttpServiceLiveStderr = appendLimited(
					this.mcpHttpServiceLiveStderr,
					text,
					40_000,
				);
			});

			child.on("error", (error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.mcpHttpServiceLastErrorMessage = message;
				this.mcpHttpServiceProc = null;
				new Notice(`AILSS MCP service failed: ${message}`);
			});

			child.on("close", (code, signal) => {
				this.mcpHttpServiceLastExitCode = code;
				this.mcpHttpServiceLastStoppedAt = nowIso();
				this.mcpHttpServiceProc = null;

				if (this.settings.mcpHttpServiceEnabled) {
					const suffix =
						code === null ? (signal ? ` (${signal})` : "") : ` (exit ${code})`;
					new Notice(`AILSS MCP service stopped${suffix}.`);
				}
			});

			new Notice(`AILSS MCP service started: ${this.getMcpHttpServiceUrl()}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.mcpHttpServiceLastErrorMessage = message;
			new Notice(`AILSS MCP service failed: ${message}`);
		}
	}

	async stopMcpHttpService(): Promise<void> {
		const child = this.mcpHttpServiceProc;
		if (!child) return;

		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					// ignore
				}
				resolve();
			}, 2_000);

			child.once("close", () => {
				clearTimeout(timeout);
				resolve();
			});

			try {
				child.kill();
			} catch {
				clearTimeout(timeout);
				resolve();
			}
		});
	}

	async restartMcpHttpService(): Promise<void> {
		await this.stopMcpHttpService();
		if (this.settings.mcpHttpServiceEnabled) {
			await this.startMcpHttpService();
		}
	}

	private async ensureMcpHttpServiceToken(): Promise<void> {
		if (this.settings.mcpHttpServiceToken.trim()) return;
		this.settings.mcpHttpServiceToken = generateToken();
		await this.saveSettings();
	}

	async reindexVault(): Promise<void> {
		const vaultPath = this.getVaultPath();
		if (this.indexerRunning) {
			new Notice("AILSS indexing is already running.");
			this.openIndexerStatusModal();
			return;
		}

		this.clearAutoIndexSchedule();
		this.autoIndexPendingPaths.clear();
		this.autoIndexNeedsRerun = false;

		this.openIndexerStatusModal();
		new Notice("AILSS indexing started…");
		try {
			await this.runIndexer();
			new Notice(`AILSS indexing complete. (${vaultPath})`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const hint = this.describeIndexerFailureHint(message);
			this.recordIndexerFailure(message);
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

	getLastIndexerLogSnapshot(): {
		log: string | null;
		finishedAt: string | null;
		exitCode: number | null;
	} {
		return {
			log: this.lastIndexerLog,
			finishedAt: this.lastIndexerFinishedAt,
			exitCode: this.lastIndexerExitCode,
		};
	}

	async saveLastIndexerLogToFile(): Promise<string> {
		const vaultPath = this.getVaultPath();
		const log = this.lastIndexerLog?.trim() ?? "";
		if (!log) throw new Error("No indexer log available.");

		const dir = path.join(vaultPath, ".ailss");
		await fs.promises.mkdir(dir, { recursive: true });

		const filePath = path.join(dir, "ailss-indexer-last.log");
		await fs.promises.writeFile(filePath, log + "\n", "utf8");
		return filePath;
	}

	confirmResetIndexDb(options: { reindexAfter: boolean }): void {
		if (this.indexerRunning) {
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
				this.enqueueAutoIndexPath(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("modify", (file: unknown) => {
				if (!(file instanceof TFile)) return;
				this.enqueueAutoIndexPath(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file: unknown) => {
				if (!(file instanceof TFile)) return;
				this.enqueueAutoIndexPath(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file: unknown, oldPath: unknown) => {
				if (!(file instanceof TFile)) return;
				if (typeof oldPath === "string") this.enqueueAutoIndexPath(oldPath);
				this.enqueueAutoIndexPath(file.path);
			}),
		);

		this.register(() => this.clearAutoIndexSchedule());
	}

	private enqueueAutoIndexPath(vaultRelPath: string): void {
		if (!this.settings.autoIndexEnabled) return;
		const normalized = normalizeVaultRelPath(vaultRelPath);
		if (!shouldIndexVaultRelPath(normalized)) return;

		this.autoIndexPendingPaths.add(normalized);
		this.scheduleAutoIndex();
	}

	private scheduleAutoIndex(): void {
		this.clearAutoIndexSchedule();

		const ms = clampDebounceMs(this.settings.autoIndexDebounceMs);
		this.autoIndexTimer = setTimeout(() => void this.flushAutoIndex(), ms);
	}

	private clearAutoIndexSchedule(): void {
		if (!this.autoIndexTimer) return;
		clearTimeout(this.autoIndexTimer);
		this.autoIndexTimer = null;
	}

	private async flushAutoIndex(): Promise<void> {
		this.clearAutoIndexSchedule();

		if (!this.settings.autoIndexEnabled) {
			this.autoIndexPendingPaths.clear();
			this.autoIndexNeedsRerun = false;
			return;
		}

		const paths = Array.from(this.autoIndexPendingPaths);
		this.autoIndexPendingPaths.clear();
		if (paths.length === 0) return;

		if (this.indexerRunning) {
			for (const p of paths) this.autoIndexPendingPaths.add(p);
			this.autoIndexNeedsRerun = true;
			return;
		}

		try {
			await this.runIndexer(paths);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordIndexerFailure(message);
			new Notice(`AILSS auto-index failed: ${message}`);
		} finally {
			if (this.autoIndexNeedsRerun) {
				this.autoIndexNeedsRerun = false;
				this.scheduleAutoIndex();
			}
		}
	}

	private async runIndexer(paths?: string[]): Promise<void> {
		try {
			const vaultPath = this.getVaultPath();
			const openaiApiKey = this.settings.openaiApiKey.trim();
			if (!openaiApiKey) {
				throw new Error(
					"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
				);
			}

			const indexerCommand = this.settings.indexerCommand.trim();
			const indexerArgs = this.resolveIndexerArgs();
			if (!indexerCommand || indexerArgs.length === 0) {
				throw new Error(
					"Missing indexer command/args. Set it in settings (e.g. command=node, args=/abs/path/to/packages/indexer/dist/cli.js).",
				);
			}

			// Env overrides for the spawned indexer process
			const env: Record<string, string> = {
				OPENAI_API_KEY: openaiApiKey,
				OPENAI_EMBEDDING_MODEL:
					this.settings.openaiEmbeddingModel.trim() ||
					DEFAULT_SETTINGS.openaiEmbeddingModel,
				AILSS_VAULT_PATH: vaultPath,
			};

			const args = [...indexerArgs, "--vault", vaultPath];
			const uniquePaths = (paths ?? [])
				.map(normalizeVaultRelPath)
				.filter(shouldIndexVaultRelPath);
			if (uniquePaths.length > 0) {
				args.push("--paths", ...Array.from(new Set(uniquePaths)));
			}
			const pathLimitedRun = uniquePaths.length > 0;

			const cwd = this.getPluginDirRealpathOrNull();
			const spawnEnv = { ...process.env, ...env };
			const resolved = resolveSpawnCommandAndEnv(indexerCommand, spawnEnv);
			if (resolved.command === "node") {
				throw new Error(nodeNotFoundMessage("Indexer"));
			}

			this.beginIndexerRun({ pathLimitedRun });
			const result = await spawnAndCapture(
				resolved.command,
				args,
				{ ...(cwd ? { cwd } : {}), env: resolved.env },
				{
					onStdoutChunk: (chunk) => {
						this.indexerLiveStdout = appendLimited(
							this.indexerLiveStdout,
							chunk,
							40_000,
						);
						this.consumeIndexerStdout(chunk);
						this.scheduleIndexerStatusUpdate();
					},
					onStderrChunk: (chunk) => {
						this.indexerLiveStderr = appendLimited(
							this.indexerLiveStderr,
							chunk,
							20_000,
						);
						this.scheduleIndexerStatusUpdate();
					},
				},
			);

			this.lastIndexerExitCode = result.code;
			this.lastIndexerFinishedAt = nowIso();
			this.lastIndexerLog = formatIndexerLog({
				command: resolved.command,
				args,
				code: result.code,
				signal: result.signal,
				stdout: result.stdout,
				stderr: result.stderr,
			});

			if (result.code !== 0) {
				const suffix = result.stderr.trim() ? `\n${result.stderr.trim()}` : "";
				throw new Error(`Process exited with code ${result.code}.${suffix}`);
			}

			this.lastIndexerSuccessAt = this.lastIndexerFinishedAt;
			await this.saveSettings();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordIndexerFailure(message);
			throw error;
		} finally {
			this.endIndexerRun();
		}
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

		this.lastIndexerLog = null;
		this.lastIndexerExitCode = null;
		this.lastIndexerFinishedAt = null;
		this.lastIndexerErrorMessage = null;
		this.lastIndexerSuccessAt = null;
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
		return {
			running: this.indexerRunning,
			startedAt: this.indexerStartedAt,
			lastSuccessAt: this.lastIndexerSuccessAt,
			lastFinishedAt: this.lastIndexerFinishedAt,
			lastExitCode: this.lastIndexerExitCode,
			lastErrorMessage: this.lastIndexerErrorMessage,
			progress: {
				filesTotal: this.indexerFilesTotal,
				filesProcessed: this.indexerFilesProcessed,
				currentFile: this.indexerCurrentFile,
				currentMode: this.indexerCurrentMode,
				chunkCurrent: this.indexerChunkCurrent,
				chunkTotal: this.indexerChunkTotal,
				summary: this.indexerSummary,
			},
			liveLog: { stdout: this.indexerLiveStdout, stderr: this.indexerLiveStderr },
		};
	}

	subscribeIndexerStatus(listener: (snapshot: AilssIndexerStatusSnapshot) => void): () => void {
		this.indexerStatusListeners.add(listener);
		listener(this.getIndexerStatusSnapshot());
		return () => this.indexerStatusListeners.delete(listener);
	}

	private registerIndexerStatusUi(): void {
		const el = this.addStatusBarItem();
		this.statusBarEl = el;
		el.addClass("ailss-obsidian-statusbar");
		el.setAttribute("role", "button");
		el.addEventListener("click", () => this.openIndexerStatusModal());
		this.register(() => el.remove());
	}

	private scheduleIndexerStatusUpdate(): void {
		if (this.indexerUiUpdateTimer) return;
		this.indexerUiUpdateTimer = setTimeout(() => {
			this.indexerUiUpdateTimer = null;
			this.emitIndexerStatusNow();
		}, 100);
	}

	private emitIndexerStatusNow(): void {
		const snapshot = this.getIndexerStatusSnapshot();
		this.updateStatusBar(snapshot);
		for (const listener of this.indexerStatusListeners) {
			listener(snapshot);
		}
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

	private beginIndexerRun(options: { pathLimitedRun: boolean }): void {
		this.indexerRunning = true;
		this.indexerStartedAt = nowIso();
		this.indexerLiveStdout = "";
		this.indexerLiveStderr = "";
		this.indexerStdoutRemainder = "";
		this.indexerPathLimitedRun = options.pathLimitedRun;
		this.indexerFilesTotal = null;
		this.indexerFilesProcessed = 0;
		this.indexerCurrentFile = null;
		this.indexerCurrentMode = null;
		this.indexerChunkCurrent = null;
		this.indexerChunkTotal = null;
		this.indexerSummary = null;
		this.lastIndexerErrorMessage = null;
		this.lastIndexerFinishedAt = null;
		this.lastIndexerExitCode = null;
		this.lastIndexerLog = null;
		this.emitIndexerStatusNow();
	}

	private endIndexerRun(): void {
		if (!this.indexerRunning) return;
		this.indexerRunning = false;
		this.indexerStartedAt = null;
		this.emitIndexerStatusNow();
	}

	private recordIndexerFailure(message: string): void {
		this.lastIndexerErrorMessage = message;
		if (!this.lastIndexerFinishedAt) this.lastIndexerFinishedAt = nowIso();
		this.emitIndexerStatusNow();
	}

	private consumeIndexerStdout(chunk: string): void {
		// Indexer progress parsing
		const chunkMatch = /\[chunks\]\s+(\d+)\/(\d+)/.exec(chunk);
		if (chunkMatch) {
			this.indexerChunkCurrent = Number(chunkMatch[1]);
			this.indexerChunkTotal = Number(chunkMatch[2]);
		}

		this.indexerStdoutRemainder += chunk;
		const lines = this.indexerStdoutRemainder.split("\n");
		this.indexerStdoutRemainder = lines.pop() ?? "";
		for (const rawLine of lines) {
			const line = rawLine.replace(/\r/g, "").trimEnd();
			this.consumeIndexerStdoutLine(line);
		}
	}

	private consumeIndexerStdoutLine(line: string): void {
		const filesMatch = /^\[ailss-indexer\]\s+files=(\d+)\s*$/.exec(line);
		if (filesMatch) {
			if (this.indexerPathLimitedRun) return;
			this.indexerFilesTotal = Number(filesMatch[1]);
			return;
		}

		const fileMatch = /^\[(index|meta)\]\s+(.+)\s*$/.exec(line);
		if (fileMatch) {
			this.indexerCurrentMode = fileMatch[1] === "index" ? "index" : "meta";
			this.indexerCurrentFile = fileMatch[2] ?? null;
			this.indexerFilesProcessed += 1;
			this.indexerChunkCurrent = null;
			this.indexerChunkTotal = null;
			return;
		}

		const summaryMatch =
			/^\[summary\]\s+changedFiles=(\d+),\s+indexedChunks=(\d+),\s+deletedFiles=(\d+)/.exec(
				line,
			);
		if (summaryMatch) {
			this.indexerSummary = {
				changedFiles: Number(summaryMatch[1]),
				indexedChunks: Number(summaryMatch[2]),
				deletedFiles: Number(summaryMatch[3]),
			};
		}
	}
}

function normalizeAilssPluginDataV1(data: AilssObsidianPluginDataV1): AilssObsidianPluginDataV1 {
	return {
		version: 1,
		settings: data.settings,
		indexer: { lastSuccessAt: data.indexer.lastSuccessAt ?? null },
	};
}

function parseAilssPluginData(raw: unknown): {
	settings: Partial<AilssObsidianSettings>;
	indexer: { lastSuccessAt: string | null };
} {
	const empty = { settings: {}, indexer: { lastSuccessAt: null } };

	if (!isRecord(raw)) return empty;

	// v1 shape
	if (raw.version === 1 && isRecord(raw.settings)) {
		const settings = { ...(raw.settings as Record<string, unknown>) };

		// Migration: renamed "Codex-only mode" -> "MCP-only mode"
		if (
			typeof settings.mcpOnlyMode !== "boolean" &&
			typeof settings.codexOnlyMode === "boolean"
		) {
			settings.mcpOnlyMode = settings.codexOnlyMode;
			delete settings.codexOnlyMode;
		}

		const indexer = isRecord(raw.indexer) ? raw.indexer : {};
		return {
			settings: settings as Partial<AilssObsidianSettings>,
			indexer: {
				lastSuccessAt:
					typeof indexer.lastSuccessAt === "string" ? indexer.lastSuccessAt : null,
			},
		};
	}

	// Legacy shape: settings object stored at the root
	const legacySettings = { ...(raw as Record<string, unknown>) };
	if (
		typeof legacySettings.mcpOnlyMode !== "boolean" &&
		typeof legacySettings.codexOnlyMode === "boolean"
	) {
		legacySettings.mcpOnlyMode = legacySettings.codexOnlyMode;
		delete legacySettings.codexOnlyMode;
	}

	return {
		settings: legacySettings as Partial<AilssObsidianSettings>,
		indexer: { lastSuccessAt: null },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
