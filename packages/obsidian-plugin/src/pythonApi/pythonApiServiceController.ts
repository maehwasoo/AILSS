import path from "node:path";
import { Notice } from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";

import { type AilssObsidianSettings, DEFAULT_SETTINGS } from "../settings.js";
import { clampPythonApiDefaultTopK, clampPythonApiPort } from "../utils/clamp.js";
import { nowIso } from "../utils/misc.js";
import { resolveSpawnCommandAndEnv } from "../utils/spawn.js";
import { waitForTcpPortToBeAvailable } from "../utils/tcp.js";
import { requestPythonApiShutdown, waitForPythonApiHealth } from "./client.js";

export type PythonApiServiceControllerDeps = {
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getVaultPath: () => string;
	getPluginDirRealpathOrNull: () => string | null;
	resolvePythonApiArgs: () => string[];
	getUrl: () => string;
	onStatusChanged: () => void;
};

type StartupPreflight = {
	host: string;
	port: number;
	topK: number;
	command: string;
	args: string[];
	vaultPath: string;
	settings: AilssObsidianSettings;
};

type PortNegotiationResult = {
	available: boolean;
	shutdownAttempted: boolean;
	shutdownSucceeded: boolean;
};

export class PythonApiServiceController {
	private proc: ChildProcess | null = null;
	private stopRequested = false;
	private startedAt: string | null = null;
	private lastExitCode: number | null = null;
	private lastStoppedAt: string | null = null;
	private lastErrorMessage: string | null = null;

	constructor(private readonly deps: PythonApiServiceControllerDeps) {}

	recordError(message: string): void {
		this.lastErrorMessage = message;
		this.deps.onStatusChanged();
	}

	isRunning(): boolean {
		return Boolean(this.proc);
	}

	getStartedAt(): string | null {
		return this.startedAt;
	}

	getLastExitCode(): number | null {
		return this.lastExitCode;
	}

	getLastStoppedAt(): string | null {
		return this.lastStoppedAt;
	}

	getLastErrorMessage(): string | null {
		return this.lastErrorMessage;
	}

	async start(): Promise<void> {
		if (this.proc) return;

		try {
			this.stopRequested = false;
			const preflight = await this.prepareStartupPreflight();
			const portState = await this.negotiatePortAvailability({
				host: preflight.host,
				port: preflight.port,
				tokens: [preflight.settings.pythonApiServiceShutdownToken],
			});
			if (!portState.available) {
				this.handlePortNegotiationFailure(preflight, portState);
				return;
			}

			const { command, args, env } = this.buildSpawnPlan(preflight);
			this.startedAt = nowIso();
			this.lastExitCode = null;
			this.lastStoppedAt = null;
			this.lastErrorMessage = null;
			this.proc = spawn(command, args, {
				stdio: ["ignore", "pipe", "pipe"],
				cwd: this.deps.getPluginDirRealpathOrNull() ?? undefined,
				env,
			});
			this.attachChildProcessListeners(this.proc);
			await this.waitUntilHealthy(preflight);
			new Notice(`AILSS Python backend started: ${this.deps.getUrl()}`);
			this.deps.onStatusChanged();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.lastErrorMessage = message;
			new Notice(`AILSS Python backend failed: ${message}`);
			this.deps.onStatusChanged();
		}
	}

	async stop(): Promise<void> {
		const child = this.proc;
		if (!child) return;

		this.stopRequested = true;
		await new Promise<void>((resolve) => {
			let settled = false;

			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(sigkillTimeout);
				clearTimeout(hardTimeout);
				resolve();
			};

			const sigkillTimeout = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					// ignore
				}
			}, 2_000);

			const hardTimeout = setTimeout(() => {
				finish();
			}, 10_000);

			child.once("close", finish);

			try {
				child.kill();
			} catch {
				// ignore
			}
		});
	}

	async restart(): Promise<void> {
		await this.stop();
		if (this.proc) {
			this.lastErrorMessage =
				"Python backend restart timed out while waiting for the previous process to stop.";
			this.deps.onStatusChanged();
			new Notice("AILSS Python backend restart failed (timed out waiting for stop).");
			return;
		}

		if (this.deps.getSettings().pythonApiServiceEnabled) {
			await this.start();
		}
	}

	private async prepareStartupPreflight(): Promise<StartupPreflight> {
		const settings = this.deps.getSettings();
		const shutdownToken = settings.pythonApiServiceShutdownToken.trim();
		if (!shutdownToken) {
			throw new Error("Missing Python backend shutdown token.");
		}

		const command = settings.pythonApiCommand.trim();
		const args = this.deps.resolvePythonApiArgs();
		if (!command || args.length === 0) {
			throw new Error(
				"Missing Python API args. Ensure apps/api exists or configure the Python backend command + args in settings.",
			);
		}

		const port = clampPythonApiPort(settings.pythonApiServicePort);
		if (port !== settings.pythonApiServicePort) {
			settings.pythonApiServicePort = port;
			await this.deps.saveSettings();
		}

		const topK = clampPythonApiDefaultTopK(settings.topK);

		return {
			host: "127.0.0.1",
			port,
			topK,
			command,
			args,
			vaultPath: this.deps.getVaultPath(),
			settings,
		};
	}

	private async negotiatePortAvailability(options: {
		host: string;
		port: number;
		tokens: string[];
	}): Promise<PortNegotiationResult> {
		let available = await waitForTcpPortToBeAvailable({
			host: options.host,
			port: options.port,
			timeoutMs: 3_000,
		});
		let shutdownAttempted = false;
		let shutdownSucceeded = false;

		if (!available) {
			shutdownAttempted = true;
			shutdownSucceeded = await this.requestShutdown(options);
			if (shutdownSucceeded) {
				available = await waitForTcpPortToBeAvailable({
					host: options.host,
					port: options.port,
					timeoutMs: 5_000,
				});
			}
		}

		return { available, shutdownAttempted, shutdownSucceeded };
	}

	private async requestShutdown(options: {
		host: string;
		port: number;
		tokens: string[];
	}): Promise<boolean> {
		return await requestPythonApiShutdown({
			host: options.host,
			port: options.port,
			tokens: options.tokens,
			recordError: (message) => {
				this.lastErrorMessage = message;
			},
		});
	}

	private handlePortNegotiationFailure(
		preflight: StartupPreflight,
		portState: PortNegotiationResult,
	): void {
		const message = this.composePortInUseErrorMessage({
			host: preflight.host,
			port: preflight.port,
			shutdownAttempted: portState.shutdownAttempted,
			shutdownSucceeded: portState.shutdownSucceeded,
		});
		this.lastErrorMessage = message;
		new Notice(`AILSS Python backend failed: ${message}`);
		this.deps.onStatusChanged();
	}

	private composePortInUseErrorMessage(options: {
		host: string;
		port: number;
		shutdownAttempted: boolean;
		shutdownSucceeded: boolean;
	}): string {
		const baseMessage =
			`Python backend port ${options.port} is already in use (${options.host}). ` +
			"Stop the process using it, or change the Python backend port in settings.";
		if (!options.shutdownAttempted || options.shutdownSucceeded || !this.lastErrorMessage) {
			return baseMessage;
		}

		return `${this.lastErrorMessage}\n\n${baseMessage}`;
	}

	private buildSpawnPlan(preflight: StartupPreflight): {
		command: string;
		args: string[];
		env: NodeJS.ProcessEnv;
	} {
		const env = this.buildServiceEnv(preflight);
		const spawnEnv = { ...process.env, ...env };
		const resolved = resolveSpawnCommandAndEnv(preflight.command, spawnEnv);
		return {
			command: resolved.command,
			args: [...preflight.args, "--host", preflight.host, "--port", String(preflight.port)],
			env: resolved.env,
		};
	}

	private buildServiceEnv(preflight: StartupPreflight): Record<string, string> {
		const env: Record<string, string> = {
			PYTHONUNBUFFERED: "1",
			AILSS_VAULT_PATH: preflight.vaultPath,
			AILSS_DB_PATH: path.join(preflight.vaultPath, ".ailss", "index.sqlite"),
			AILSS_API_DEFAULT_TOP_K: String(preflight.topK),
			AILSS_OPENAI_EMBEDDING_MODEL:
				preflight.settings.openaiEmbeddingModel.trim() ||
				DEFAULT_SETTINGS.openaiEmbeddingModel,
		};

		const openaiApiKey = preflight.settings.openaiApiKey.trim();
		if (openaiApiKey) {
			env.AILSS_OPENAI_API_KEY = openaiApiKey;
			env.OPENAI_API_KEY = openaiApiKey;
		}
		env.AILSS_API_SHUTDOWN_TOKEN = preflight.settings.pythonApiServiceShutdownToken;

		return env;
	}

	private async waitUntilHealthy(preflight: StartupPreflight): Promise<void> {
		try {
			await waitForPythonApiHealth({
				host: preflight.host,
				port: preflight.port,
				timeoutMs: 5_000,
				pollIntervalMs: 150,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.stop();
			this.lastErrorMessage = message;
			this.deps.onStatusChanged();
			throw new Error(`Python backend failed readiness check: ${message}`);
		}
	}

	private attachChildProcessListeners(child: ChildProcess): void {
		child.on("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.lastErrorMessage = message;
			this.proc = null;
			this.deps.onStatusChanged();
			new Notice(`AILSS Python backend failed: ${message}`);
		});

		child.on("close", (code, signal) => {
			this.lastExitCode = code;
			this.lastStoppedAt = nowIso();
			this.proc = null;

			const stopRequested = this.stopRequested;
			this.stopRequested = false;

			if (stopRequested) {
				this.lastErrorMessage = null;
			} else if ((code !== null && code !== 0) || (code === null && signal)) {
				this.lastErrorMessage =
					code === null
						? `Python backend stopped unexpectedly (signal ${signal ?? "unknown"}).`
						: `Python backend stopped unexpectedly (exit ${code}).`;
			} else {
				this.lastErrorMessage = null;
			}

			this.deps.onStatusChanged();
		});
	}
}
