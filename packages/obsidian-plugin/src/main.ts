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
import { ConfirmModal } from "./ui/confirmModal.js";
import { AilssIndexerLogModal } from "./ui/indexerLogModal.js";

export default class AilssObsidianPlugin extends Plugin {
	settings!: AilssObsidianSettings;

	private autoIndexTimer: NodeJS.Timeout | null = null;
	private autoIndexPendingPaths = new Set<string>();
	private autoIndexNeedsRerun = false;
	private indexerRunning = false;
	private lastIndexerLog: string | null = null;
	private lastIndexerFinishedAt: string | null = null;
	private lastIndexerExitCode: number | null = null;

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
		const message = [
			"This will delete the AILSS index DB file and its WAL/SHM files.",
			`DB: ${dbPath}`,
			"Your markdown notes are not modified.",
			options.reindexAfter ? "After reset, indexing will start immediately." : "",
		]
			.filter(Boolean)
			.join("\n");

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
		const resolved = resolveSpawnCommandAndEnv(indexerCommand, spawnEnv);
		if (resolved.command === "node") {
			throw new Error(nodeNotFoundMessage("Indexer"));
		}

		this.indexerRunning = true;
		this.lastIndexerLog = null;
		this.lastIndexerFinishedAt = null;
		this.lastIndexerExitCode = null;
		try {
			const result = await spawnAndCapture(resolved.command, args, {
				...(cwd ? { cwd } : {}),
				env: resolved.env,
			});

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

		return deletedPaths.length;
	}

	private describeIndexerFailureHint(message: string): string | null {
		const msg = message.toLowerCase();

		if (msg.includes("dimension mismatch") && msg.includes("embedding")) {
			return "Embedding model mismatch: reset the index DB (Settings → AILSS Obsidian → Index maintenance) or switch the embedding model back to the one used when the DB was created.";
		}

		if (msg.includes("missed comma between flow collection entries")) {
			return 'YAML frontmatter parse error: if you have unquoted Obsidian wikilinks in frontmatter lists (e.g. `- [[Some Note]]`), quote them: `- "[[Some Note]]"`. Use the indexer log to see which file was being indexed.';
		}

		return null;
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

type SpawnCaptureResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

async function spawnAndCapture(
	command: string,
	args: string[],
	options: SpawnOptions,
): Promise<SpawnCaptureResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const limit = 80_000;
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: unknown) => {
			stdout = appendLimited(stdout, chunk, limit);
		});
		child.stderr?.on("data", (chunk: unknown) => {
			stderr = appendLimited(stderr, chunk, limit);
		});

		child.on("error", (error) => {
			reject(enhanceSpawnError(error, command, options.env));
		});
		child.on("close", (code, signal) => {
			resolve({ code, signal, stdout, stderr });
		});
	});
}

function resolveSpawnCommandAndEnv(
	command: string,
	env: NodeJS.ProcessEnv,
): { command: string; env: NodeJS.ProcessEnv } {
	const normalizedEnv = normalizeSpawnEnv(env);
	if (command !== "node") return { command, env: normalizedEnv };
	if (looksLikePath(command)) return { command, env: normalizedEnv };

	const resolvedNode = resolveNodeExecutable(normalizedEnv);
	if (resolvedNode) return { command: resolvedNode, env: normalizedEnv };

	return { command, env: normalizedEnv };
}

function normalizeSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const normalized: NodeJS.ProcessEnv = { ...env };

	const existingPath = readEnvPath(normalized);
	const extra = defaultExtraPathEntries();
	const merged = mergePathEntries(existingPath, extra);

	normalized.PATH = merged;
	if (typeof normalized["Path"] === "string") normalized["Path"] = merged;

	return normalized;
}

function readEnvPath(env: NodeJS.ProcessEnv): string {
	const candidate = env.PATH ?? env["Path"];
	return typeof candidate === "string" ? candidate : "";
}

function defaultExtraPathEntries(): string[] {
	// Common Node install locations
	if (process.platform === "darwin") {
		return ["/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"];
	}

	if (process.platform === "linux") {
		return ["/usr/local/bin", "/usr/bin"];
	}

	return [];
}

function mergePathEntries(existing: string, extra: string[]): string {
	const delimiter = path.delimiter;
	const existingParts = existing
		.split(delimiter)
		.map((p) => p.trim())
		.filter(Boolean);

	const seen = new Set<string>(existingParts.map((p) => normalizePathKey(p)));
	const merged = [...existingParts];
	for (const entry of extra) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const key = normalizePathKey(trimmed);
		if (seen.has(key)) continue;
		merged.push(trimmed);
		seen.add(key);
	}

	return merged.join(delimiter);
}

function normalizePathKey(p: string): string {
	return process.platform === "win32" ? p.toLowerCase() : p;
}

function looksLikePath(command: string): boolean {
	return command.includes("/") || command.includes("\\");
}

function resolveNodeExecutable(env: NodeJS.ProcessEnv): string | null {
	const fromPath = findExecutableInEnvPath("node", env);
	if (fromPath) return fromPath;

	for (const candidate of knownNodeExecutablePaths(env)) {
		if (isExecutableFile(candidate)) return candidate;
	}

	const nvmNode = resolveNodeFromNvm(env);
	if (nvmNode) return nvmNode;

	return null;
}

function knownNodeExecutablePaths(env: NodeJS.ProcessEnv): string[] {
	if (process.platform === "darwin") {
		return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node"];
	}

	if (process.platform === "linux") {
		return ["/usr/local/bin/node", "/usr/bin/node"];
	}

	if (process.platform === "win32") {
		const candidates: string[] = [];
		const programFiles = env.ProgramFiles;
		const programFilesX86 = env["ProgramFiles(x86)"];
		if (programFiles) candidates.push(path.join(programFiles, "nodejs", "node.exe"));
		if (programFilesX86) candidates.push(path.join(programFilesX86, "nodejs", "node.exe"));
		return candidates;
	}

	return [];
}

function findExecutableInEnvPath(command: string, env: NodeJS.ProcessEnv): string | null {
	const pathValue = readEnvPath(env);
	if (!pathValue) return null;

	const dirs = pathValue
		.split(path.delimiter)
		.map((p) => p.trim())
		.filter(Boolean);

	const candidates =
		process.platform === "win32" ? windowsCommandCandidates(command, env) : [command];
	for (const dir of dirs) {
		for (const file of candidates) {
			const full = path.join(dir, file);
			if (isExecutableFile(full)) return full;
		}
	}

	return null;
}

function windowsCommandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
	// PATHEXT-based candidates
	if (path.extname(command)) return [command];

	const pathext = typeof env.PATHEXT === "string" ? env.PATHEXT : ".EXE;.CMD;.BAT;.COM";
	const exts = pathext
		.split(";")
		.map((e) => e.trim())
		.filter(Boolean);

	return exts.map((ext) => command + ext.toLowerCase());
}

function isExecutableFile(filePath: string): boolean {
	try {
		const stat = fs.statSync(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}

function resolveNodeFromNvm(env: NodeJS.ProcessEnv): string | null {
	const home = env.HOME ?? env.USERPROFILE;
	const nvmDir = env.NVM_DIR ?? (home ? path.join(home, ".nvm") : undefined);
	if (!nvmDir) return null;

	const aliasDefault = path.join(nvmDir, "alias", "default");
	const pinned = tryReadNvmVersionAlias(aliasDefault);
	if (pinned) {
		const candidate = path.join(nvmDir, "versions", "node", pinned, "bin", "node");
		if (isExecutableFile(candidate)) return candidate;
	}

	const versionsDir = path.join(nvmDir, "versions", "node");
	const best = findBestNvmInstalledNodeVersion(versionsDir);
	if (!best) return null;

	const candidate = path.join(versionsDir, best, "bin", "node");
	return isExecutableFile(candidate) ? candidate : null;
}

function tryReadNvmVersionAlias(filePath: string): string | null {
	try {
		const raw = fs.readFileSync(filePath, "utf8").trim();
		if (!raw) return null;
		// nvm stores versions like "v20.11.0"
		return /^v\d+\.\d+\.\d+$/.test(raw) ? raw : null;
	} catch {
		return null;
	}
}

function findBestNvmInstalledNodeVersion(versionsDir: string): string | null {
	try {
		const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
		const versions = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.filter((name) => /^v\d+\.\d+\.\d+$/.test(name));

		if (versions.length === 0) return null;

		versions.sort((a, b) => compareSemverDesc(a, b));
		return versions[0] ?? null;
	} catch {
		return null;
	}
}

function compareSemverDesc(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return 0;

	if (pa[0] !== pb[0]) return pb[0] - pa[0];
	if (pa[1] !== pb[1]) return pb[1] - pa[1];
	return pb[2] - pa[2];
}

function parseSemver(v: string): [number, number, number] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toStringEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

function enhanceSpawnError(error: unknown, command: string, env: NodeJS.ProcessEnv): Error {
	if (isErrnoException(error) && error.code === "ENOENT") {
		const pathValue = readEnvPath(env);
		const base = `Failed to start process: ${command} (ENOENT: not found).`;

		if (path.basename(command) === "node" || path.basename(command) === "node.exe") {
			return new Error(
				`${base}\n\n${nodeNotFoundMessage("Indexer")}\n\nPATH=${pathValue || "<empty>"}`,
			);
		}

		return new Error(`${base}\n\nPATH=${pathValue || "<empty>"}`);
	}

	return error instanceof Error ? error : new Error(String(error));
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		!!error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	);
}

function nodeNotFoundMessage(kind: "MCP" | "Indexer"): string {
	const locateCommand = process.platform === "win32" ? "where node" : "which node";
	const examples = nodePathExamplesByPlatform();
	const hint = examples.length > 0 ? `Common paths: ${examples.join(", ")}` : "";

	return [
		`Could not find a Node.js executable for the ${kind} command.`,
		"Obsidian may not inherit your shell PATH (especially on macOS).",
		`Fix: Settings → Community plugins → AILSS Obsidian → ${kind} → Command: set it to your absolute Node path (from running '${locateCommand}' in your terminal).`,
		hint,
	]
		.filter(Boolean)
		.join("\n");
}

function nodePathExamplesByPlatform(): string[] {
	if (process.platform === "darwin") return ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
	if (process.platform === "linux") return ["/usr/bin/node", "/usr/local/bin/node"];
	if (process.platform === "win32") return ["C:\\\\Program Files\\\\nodejs\\\\node.exe"];
	return [];
}

function nowIso(): string {
	return new Date().toISOString().slice(0, 19);
}

function appendLimited(existing: string, chunk: unknown, limit: number): string {
	const next = existing + (typeof chunk === "string" ? chunk : String(chunk));
	if (next.length <= limit) return next;
	return next.slice(next.length - limit);
}

function formatIndexerLog(input: {
	command: string;
	args: string[];
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}): string {
	const header = [
		`[time] ${nowIso()}`,
		`[command] ${input.command} ${input.args.join(" ")}`,
		`[exit] ${input.code ?? "null"}${input.signal ? ` (signal ${input.signal})` : ""}`,
	]
		.filter(Boolean)
		.join("\n");

	return [
		header,
		"",
		"[stdout]",
		input.stdout.trimEnd(),
		"",
		"[stderr]",
		input.stderr.trimEnd(),
		"",
	].join("\n");
}

function parseCliArgValue(args: string[], key: string): string | null {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] ?? "";
		if (arg === key) {
			const next = args[i + 1];
			return typeof next === "string" ? next : null;
		}

		if (arg.startsWith(`${key}=`)) {
			return arg.slice(key.length + 1);
		}
	}

	return null;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.stat(filePath);
		return true;
	} catch {
		return false;
	}
}
