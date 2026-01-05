import { FileSystemAdapter, Notice, Plugin, TFile } from "obsidian";
import { spawn } from "node:child_process";
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

export default class AilssObsidianPlugin extends Plugin {
	settings!: AilssObsidianSettings;

	private autoIndexTimer: NodeJS.Timeout | null = null;
	private autoIndexPendingPaths = new Set<string>();
	private autoIndexNeedsRerun = false;
	private indexerRunning = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new AilssObsidianSettingTab(this.app, this));
		registerCommands(this);
		this.registerAutoIndexEvents();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<AilssObsidianSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async reindexVault(): Promise<void> {
		const vaultPath = this.getVaultPath();
		if (this.indexerRunning) {
			new Notice("AILSS indexing is already running.");
			return;
		}

		this.clearAutoIndexSchedule();
		this.autoIndexPendingPaths.clear();
		this.autoIndexNeedsRerun = false;

		new Notice("AILSS indexing started…");
		try {
			await this.runIndexer();
			new Notice(`AILSS indexing complete. (${vaultPath})`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`AILSS indexing failed: ${message}`);
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
		const client = new AilssMcpClient({
			command: mcpCommand,
			args: mcpArgs,
			env,
			...(cwd ? { cwd } : {}),
		});

		try {
			return await client.semanticSearch(query, clampTopK(this.settings.topK));
		} finally {
			await client.close();
		}
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
			new Notice(`AILSS auto-index failed: ${message}`);
		} finally {
			if (this.autoIndexNeedsRerun) {
				this.autoIndexNeedsRerun = false;
				this.scheduleAutoIndex();
			}
		}
	}

	private async runIndexer(paths?: string[]): Promise<void> {
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
				this.settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
			AILSS_VAULT_PATH: vaultPath,
		};

		const args = [...indexerArgs, "--vault", vaultPath];
		const uniquePaths = (paths ?? [])
			.map(normalizeVaultRelPath)
			.filter(shouldIndexVaultRelPath);
		if (uniquePaths.length > 0) {
			args.push("--paths", ...Array.from(new Set(uniquePaths)));
		}

		const cwd = this.getPluginDirRealpathOrNull();
		const spawnEnv = { ...process.env, ...env };

		this.indexerRunning = true;
		try {
			await spawnAndWait(indexerCommand, args, {
				...(cwd ? { cwd } : {}),
				env: spawnEnv,
			});
		} finally {
			this.indexerRunning = false;
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
}

function clampTopK(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.topK);
	if (n < 1) return 1;
	if (n > 50) return 50;
	return n;
}

function clampDebounceMs(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.autoIndexDebounceMs);
	if (n < 250) return 250;
	if (n > 60_000) return 60_000;
	return n;
}

function normalizeVaultRelPath(input: string): string {
	return input.split("\\").join("/").trim();
}

function shouldIndexVaultRelPath(vaultRelPath: string): boolean {
	if (!vaultRelPath.toLowerCase().endsWith(".md")) return false;

	const dirs = vaultRelPath.split("/").slice(0, -1);
	for (const dir of dirs) {
		if (
			dir === ".git" ||
			dir === ".obsidian" ||
			dir === ".trash" ||
			dir === ".backups" ||
			dir === ".ailss" ||
			dir === "node_modules"
		) {
			return false;
		}
	}

	return true;
}

type SpawnOptions = { cwd?: string; env: NodeJS.ProcessEnv };

async function spawnAndWait(command: string, args: string[], options: SpawnOptions): Promise<void> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "ignore", "pipe"],
		});

		let stderr = "";
		child.stderr?.on("data", (chunk: unknown) => {
			stderr += typeof chunk === "string" ? chunk : String(chunk);
		});

		child.on("error", (error) => reject(error));
		child.on("close", (code) => {
			if (code === 0) return resolve();
			const suffix = stderr.trim() ? `\n${stderr.trim()}` : "";
			reject(new Error(`Process exited with code ${code}.${suffix}`));
		});
	});
}
