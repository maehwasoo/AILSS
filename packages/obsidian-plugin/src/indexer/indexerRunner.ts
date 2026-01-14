import { DEFAULT_SETTINGS, type AilssObsidianSettings } from "../settings.js";
import { appendLimited, formatIndexerLog, nowIso } from "../utils/misc.js";
import { nodeNotFoundMessage, resolveSpawnCommandAndEnv, spawnAndCapture } from "../utils/spawn.js";
import { normalizeVaultRelPath, shouldIndexVaultRelPath } from "../utils/vault.js";

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

export type IndexerRunnerDeps = {
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getVaultPath: () => string;
	getPluginDirRealpathOrNull: () => string | null;
	resolveIndexerArgs: () => string[];
	onSnapshot: (snapshot: AilssIndexerStatusSnapshot) => void;
};

export class IndexerRunner {
	private listeners = new Set<(snapshot: AilssIndexerStatusSnapshot) => void>();
	private uiUpdateTimer: NodeJS.Timeout | null = null;

	private running = false;
	private lastLog: string | null = null;
	private lastFinishedAt: string | null = null;
	private lastExitCode: number | null = null;
	private lastErrorMessage: string | null = null;
	private lastSuccessAt: string | null = null;

	private startedAt: string | null = null;
	private liveStdout = "";
	private liveStderr = "";
	private stdoutRemainder = "";
	private pathLimitedRun = false;
	private filesTotal: number | null = null;
	private filesProcessed = 0;
	private currentFile: string | null = null;
	private currentMode: "index" | "meta" | null = null;
	private chunkCurrent: number | null = null;
	private chunkTotal: number | null = null;
	private summary: {
		changedFiles: number;
		indexedChunks: number;
		deletedFiles: number;
	} | null = null;

	constructor(private readonly deps: IndexerRunnerDeps) {}

	isRunning(): boolean {
		return this.running;
	}

	getLastSuccessAt(): string | null {
		return this.lastSuccessAt;
	}

	setLastSuccessAt(value: string | null): void {
		this.lastSuccessAt = value;
	}

	clearHistory(): void {
		this.lastLog = null;
		this.lastExitCode = null;
		this.lastFinishedAt = null;
		this.lastErrorMessage = null;
		this.lastSuccessAt = null;
	}

	getLastLogSnapshot(): {
		log: string | null;
		finishedAt: string | null;
		exitCode: number | null;
	} {
		return {
			log: this.lastLog,
			finishedAt: this.lastFinishedAt,
			exitCode: this.lastExitCode,
		};
	}

	getLastLog(): string | null {
		return this.lastLog;
	}

	getStatusSnapshot(): AilssIndexerStatusSnapshot {
		return {
			running: this.running,
			startedAt: this.startedAt,
			lastSuccessAt: this.lastSuccessAt,
			lastFinishedAt: this.lastFinishedAt,
			lastExitCode: this.lastExitCode,
			lastErrorMessage: this.lastErrorMessage,
			progress: {
				filesTotal: this.filesTotal,
				filesProcessed: this.filesProcessed,
				currentFile: this.currentFile,
				currentMode: this.currentMode,
				chunkCurrent: this.chunkCurrent,
				chunkTotal: this.chunkTotal,
				summary: this.summary,
			},
			liveLog: { stdout: this.liveStdout, stderr: this.liveStderr },
		};
	}

	subscribe(listener: (snapshot: AilssIndexerStatusSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.getStatusSnapshot());
		return () => this.listeners.delete(listener);
	}

	emitNow(): void {
		const snapshot = this.getStatusSnapshot();
		this.deps.onSnapshot(snapshot);
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}

	private scheduleStatusUpdate(): void {
		if (this.uiUpdateTimer) return;
		this.uiUpdateTimer = setTimeout(() => {
			this.uiUpdateTimer = null;
			this.emitNow();
		}, 100);
	}

	async run(paths?: string[]): Promise<void> {
		try {
			const vaultPath = this.deps.getVaultPath();
			const settings = this.deps.getSettings();
			const openaiApiKey = settings.openaiApiKey.trim();
			if (!openaiApiKey) {
				throw new Error(
					"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
				);
			}

			const indexerCommand = settings.indexerCommand.trim();
			const indexerArgs = this.deps.resolveIndexerArgs();
			if (!indexerCommand || indexerArgs.length === 0) {
				throw new Error(
					"Missing indexer command/args. Set it in settings (e.g. command=node, args=/abs/path/to/packages/indexer/dist/cli.js).",
				);
			}

			// Env overrides for the spawned indexer process
			const env: Record<string, string> = {
				OPENAI_API_KEY: openaiApiKey,
				OPENAI_EMBEDDING_MODEL:
					settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
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

			const cwd = this.deps.getPluginDirRealpathOrNull();
			const spawnEnv = { ...process.env, ...env };
			const resolved = resolveSpawnCommandAndEnv(indexerCommand, spawnEnv);
			if (resolved.command === "node") {
				throw new Error(nodeNotFoundMessage("Indexer"));
			}

			this.beginRun({ pathLimitedRun });
			const result = await spawnAndCapture(
				resolved.command,
				args,
				{ ...(cwd ? { cwd } : {}), env: resolved.env },
				{
					onStdoutChunk: (chunk) => {
						this.liveStdout = appendLimited(this.liveStdout, chunk, 40_000);
						this.consumeStdout(chunk);
						this.scheduleStatusUpdate();
					},
					onStderrChunk: (chunk) => {
						this.liveStderr = appendLimited(this.liveStderr, chunk, 20_000);
						this.scheduleStatusUpdate();
					},
				},
			);

			this.lastExitCode = result.code;
			this.lastFinishedAt = nowIso();
			this.lastLog = formatIndexerLog({
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

			this.lastSuccessAt = this.lastFinishedAt;
			await this.deps.saveSettings();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordFailure(message);
			throw error;
		} finally {
			this.endRun();
		}
	}

	private beginRun(options: { pathLimitedRun: boolean }): void {
		this.running = true;
		this.startedAt = nowIso();
		this.liveStdout = "";
		this.liveStderr = "";
		this.stdoutRemainder = "";
		this.pathLimitedRun = options.pathLimitedRun;
		this.filesTotal = null;
		this.filesProcessed = 0;
		this.currentFile = null;
		this.currentMode = null;
		this.chunkCurrent = null;
		this.chunkTotal = null;
		this.summary = null;
		this.lastErrorMessage = null;
		this.lastFinishedAt = null;
		this.lastExitCode = null;
		this.lastLog = null;
		this.emitNow();
	}

	private endRun(): void {
		if (!this.running) return;
		this.running = false;
		this.startedAt = null;
		this.emitNow();
	}

	private recordFailure(message: string): void {
		this.lastErrorMessage = message;
		if (!this.lastFinishedAt) this.lastFinishedAt = nowIso();
		this.emitNow();
	}

	private consumeStdout(chunk: string): void {
		// Indexer progress parsing
		const chunkMatch = /\[chunks\]\s+(\d+)\/(\d+)/.exec(chunk);
		if (chunkMatch) {
			this.chunkCurrent = Number(chunkMatch[1]);
			this.chunkTotal = Number(chunkMatch[2]);
		}

		this.stdoutRemainder += chunk;
		const lines = this.stdoutRemainder.split("\n");
		this.stdoutRemainder = lines.pop() ?? "";
		for (const rawLine of lines) {
			const line = rawLine.replace(/\r/g, "").trimEnd();
			this.consumeStdoutLine(line);
		}
	}

	private consumeStdoutLine(line: string): void {
		const filesMatch = /^\[ailss-indexer\]\s+files=(\d+)\s*$/.exec(line);
		if (filesMatch) {
			if (this.pathLimitedRun) return;
			this.filesTotal = Number(filesMatch[1]);
			return;
		}

		const fileMatch = /^\[(index|meta)\]\s+(.+)\s*$/.exec(line);
		if (fileMatch) {
			this.currentMode = fileMatch[1] === "index" ? "index" : "meta";
			this.currentFile = fileMatch[2] ?? null;
			this.filesProcessed += 1;
			this.chunkCurrent = null;
			this.chunkTotal = null;
			return;
		}

		const summaryMatch =
			/^\[summary\]\s+changedFiles=(\d+),\s+indexedChunks=(\d+),\s+deletedFiles=(\d+)/.exec(
				line,
			);
		if (summaryMatch) {
			this.summary = {
				changedFiles: Number(summaryMatch[1]),
				indexedChunks: Number(summaryMatch[2]),
				deletedFiles: Number(summaryMatch[3]),
			};
		}
	}
}
