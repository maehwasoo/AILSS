import { Notice } from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";

import { type AilssObsidianSettings } from "../settings.js";
import { appendLimited, nowIso } from "../utils/misc.js";
import { waitForTcpPortToBeAvailable } from "../utils/tcp.js";

import {
	appendDurableLogChunk as appendDurableLogChunkHelper,
	initializeDurableLog as initializeDurableLogHelper,
} from "./httpService/durableLog.js";
import {
	composePortInUseErrorMessage as composePortInUseErrorMessageHelper,
	composeUnexpectedStopErrorMessage as composeUnexpectedStopErrorMessageHelper,
} from "./httpService/messages.js";
import {
	normalizeStartupSettings as normalizeStartupSettingsHelper,
	prepareStartupPreflight as prepareStartupPreflightHelper,
	type StartupPreflight,
} from "./httpService/preflight.js";
import { buildSpawnPlan as buildSpawnPlanHelper, type SpawnPlan } from "./httpService/spawnPlan.js";
import {
	requestShutdown as requestShutdownHelper,
	requestShutdownOnce as requestShutdownOnceHelper,
} from "./httpService/shutdownClient.js";

export type McpHttpServiceControllerDeps = {
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getVaultPath: () => string;
	getPluginDirRealpathOrNull: () => string | null;
	resolveMcpHttpArgs: () => string[];
	getUrl: () => string;
	onStatusChanged: () => void;
};

type PortNegotiationResult = {
	available: boolean;
	shutdownAttempted: boolean;
	shutdownSucceeded: boolean;
};

export class McpHttpServiceController {
	private proc: ChildProcess | null = null;
	private stopRequested = false;
	private liveStdout = "";
	private liveStderr = "";
	private startedAt: string | null = null;
	private lastExitCode: number | null = null;
	private lastStoppedAt: string | null = null;
	private lastErrorMessage: string | null = null;
	private durableLogPath: string | null = null;
	private durableLogWriteQueue: Promise<void> = Promise.resolve();

	constructor(private readonly deps: McpHttpServiceControllerDeps) {}

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
				tokens: [preflight.shutdownToken, preflight.token],
			});
			if (!portState.available) {
				this.handlePortNegotiationFailure(preflight, portState);
				return;
			}

			const plan = this.buildSpawnPlan(preflight);
			this.resetStartupState();
			const child = this.spawnServiceProcess(plan);
			this.proc = child;
			this.deps.onStatusChanged();

			this.attachChildProcessListeners(child);

			new Notice(`AILSS MCP service started: ${this.deps.getUrl()}`);
			this.deps.onStatusChanged();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.lastErrorMessage = message;
			new Notice(`AILSS MCP service failed: ${message}`);
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
				"MCP service restart timed out while waiting for the previous process to stop.";
			this.deps.onStatusChanged();
			new Notice("AILSS MCP service restart failed (timed out waiting for stop).");
			return;
		}

		if (this.deps.getSettings().mcpHttpServiceEnabled) {
			await this.start();
		}
	}

	private async prepareStartupPreflight(): Promise<StartupPreflight> {
		return await prepareStartupPreflightHelper({
			getSettings: this.deps.getSettings,
			saveSettings: this.deps.saveSettings,
			getVaultPath: this.deps.getVaultPath,
			resolveMcpHttpArgs: this.deps.resolveMcpHttpArgs,
			normalizeStartupSettings: async (settings) =>
				await this.normalizeStartupSettings(settings),
		});
	}

	private async normalizeStartupSettings(settings: AilssObsidianSettings): Promise<{
		port: number;
		topK: number;
	}> {
		return await normalizeStartupSettingsHelper({
			settings,
			saveSettings: this.deps.saveSettings,
		});
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
			shutdownSucceeded = await this.requestShutdown({
				host: options.host,
				port: options.port,
				tokens: options.tokens,
			});

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
		new Notice(`AILSS MCP service failed: ${message}`);
		this.deps.onStatusChanged();
	}

	private composePortInUseErrorMessage(options: {
		host: string;
		port: number;
		shutdownAttempted: boolean;
		shutdownSucceeded: boolean;
	}): string {
		return composePortInUseErrorMessageHelper({
			host: options.host,
			port: options.port,
			shutdownAttempted: options.shutdownAttempted,
			shutdownSucceeded: options.shutdownSucceeded,
			lastErrorMessage: this.lastErrorMessage,
		});
	}

	private buildSpawnPlan(preflight: StartupPreflight): SpawnPlan {
		return buildSpawnPlanHelper({
			preflight,
			cwd: this.deps.getPluginDirRealpathOrNull(),
		});
	}

	private resetStartupState(): void {
		this.liveStdout = "";
		this.liveStderr = "";
		this.startedAt = nowIso();
		this.lastExitCode = null;
		this.lastStoppedAt = null;
		this.lastErrorMessage = null;
		const durable = initializeDurableLogHelper({
			vaultPath: this.deps.getVaultPath(),
			durableLogWriteQueue: this.durableLogWriteQueue,
		});
		this.durableLogPath = durable.durableLogPath;
		this.durableLogWriteQueue = durable.durableLogWriteQueue;
	}

	private appendDurableLogChunk(stream: "stdout" | "stderr", chunk: string): void {
		const durable = appendDurableLogChunkHelper({
			durableLogPath: this.durableLogPath,
			durableLogWriteQueue: this.durableLogWriteQueue,
			stream,
			chunk,
		});
		this.durableLogWriteQueue = durable.durableLogWriteQueue;
	}

	private spawnServiceProcess(plan: SpawnPlan): ChildProcess {
		return spawn(plan.command, plan.args, {
			stdio: ["ignore", "pipe", "pipe"],
			...(plan.cwd ? { cwd: plan.cwd } : {}),
			env: plan.env,
		});
	}

	private attachChildProcessListeners(child: ChildProcess): void {
		child.stdout?.on("data", (chunk: unknown) => {
			const text = typeof chunk === "string" ? chunk : String(chunk);
			this.liveStdout = appendLimited(this.liveStdout, text, 40_000);
			this.appendDurableLogChunk("stdout", text);
		});

		child.stderr?.on("data", (chunk: unknown) => {
			const text = typeof chunk === "string" ? chunk : String(chunk);
			this.liveStderr = appendLimited(this.liveStderr, text, 40_000);
			this.appendDurableLogChunk("stderr", text);
		});

		child.on("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.lastErrorMessage = message;
			this.proc = null;
			this.deps.onStatusChanged();
			new Notice(`AILSS MCP service failed: ${message}`);
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
				this.lastErrorMessage = this.composeUnexpectedStopErrorMessage(code, signal);
			} else {
				this.lastErrorMessage = null;
			}

			this.deps.onStatusChanged();

			if (this.deps.getSettings().mcpHttpServiceEnabled) {
				const suffix = code === null ? (signal ? ` (${signal})` : "") : ` (exit ${code})`;
				new Notice(`AILSS MCP service stopped${suffix}.`);
			}
		});
	}

	private composeUnexpectedStopErrorMessage(
		code: number | null,
		signal: NodeJS.Signals | null,
	): string {
		return composeUnexpectedStopErrorMessageHelper({
			code,
			signal,
			liveStderr: this.liveStderr,
			durableLogPath: this.durableLogPath,
		});
	}

	private async requestShutdown(options: {
		host: string;
		port: number;
		tokens: string[];
	}): Promise<boolean> {
		return await requestShutdownHelper({
			host: options.host,
			port: options.port,
			tokens: options.tokens,
			requestShutdownOnce: async (inner) => await this.requestShutdownOnce(inner),
		});
	}

	private async requestShutdownOnce(options: {
		host: string;
		port: number;
		token: string;
	}): Promise<{ ok: boolean; status: number | null }> {
		return await requestShutdownOnceHelper({
			host: options.host,
			port: options.port,
			token: options.token,
			recordError: (message) => this.recordError(message),
		});
	}
}
