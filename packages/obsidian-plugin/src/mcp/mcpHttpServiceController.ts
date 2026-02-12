import { Notice } from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { DEFAULT_SETTINGS, type AilssObsidianSettings } from "../settings.js";
import { clampPort, clampTopK } from "../utils/clamp.js";
import { appendLimited, nowIso } from "../utils/misc.js";
import { nodeNotFoundMessage, resolveSpawnCommandAndEnv } from "../utils/spawn.js";
import { waitForTcpPortToBeAvailable } from "../utils/tcp.js";

export type McpHttpServiceControllerDeps = {
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getVaultPath: () => string;
	getPluginDirRealpathOrNull: () => string | null;
	resolveMcpHttpArgs: () => string[];
	getUrl: () => string;
	onStatusChanged: () => void;
};

type StartupPreflight = {
	settings: AilssObsidianSettings;
	host: string;
	port: number;
	topK: number;
	token: string;
	shutdownToken: string;
	openaiApiKey: string;
	mcpCommand: string;
	mcpArgs: string[];
	vaultPath: string;
};

type PortNegotiationResult = {
	available: boolean;
	shutdownAttempted: boolean;
	shutdownSucceeded: boolean;
};

type SpawnPlan = {
	command: string;
	args: string[];
	cwd: string | null;
	env: NodeJS.ProcessEnv;
};

const MCP_HTTP_LOG_DIR = ".ailss";
const MCP_HTTP_LOG_FILE = "ailss-mcp-http-last.log";

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
		const settings = this.deps.getSettings();
		const token = settings.mcpHttpServiceToken.trim();
		if (!token) {
			throw new Error("Missing MCP service token.");
		}

		const shutdownToken = settings.mcpHttpServiceShutdownToken.trim();
		if (!shutdownToken) {
			throw new Error("Missing MCP shutdown token.");
		}

		const openaiApiKey = settings.openaiApiKey.trim();
		if (!openaiApiKey) {
			throw new Error(
				"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
			);
		}

		const mcpCommand = settings.mcpCommand.trim();
		const mcpArgs = this.deps.resolveMcpHttpArgs();
		if (!mcpCommand || mcpArgs.length === 0) {
			throw new Error(
				"Missing MCP HTTP server args. Build @ailss/mcp and ensure dist/http.js exists (or configure the MCP server path in settings).",
			);
		}

		const { port, topK } = await this.normalizeStartupSettings(settings);
		return {
			settings,
			host: "127.0.0.1",
			port,
			topK,
			token,
			shutdownToken,
			openaiApiKey,
			mcpCommand,
			mcpArgs,
			vaultPath: this.deps.getVaultPath(),
		};
	}

	private async normalizeStartupSettings(settings: AilssObsidianSettings): Promise<{
		port: number;
		topK: number;
	}> {
		const port = clampPort(settings.mcpHttpServicePort);
		if (port !== settings.mcpHttpServicePort) {
			settings.mcpHttpServicePort = port;
			await this.deps.saveSettings();
		}

		const topK = clampTopK(settings.topK);
		if (topK !== settings.topK) {
			settings.topK = topK;
			await this.deps.saveSettings();
		}

		return { port, topK };
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
		const baseMessage = `Port ${options.port} is already in use (${options.host}). Stop the process using it, or change the port in settings.`;
		if (options.shutdownAttempted && !options.shutdownSucceeded && this.lastErrorMessage) {
			return `${this.lastErrorMessage}\n\n${baseMessage}`;
		}

		return baseMessage;
	}

	private buildSpawnPlan(preflight: StartupPreflight): SpawnPlan {
		const env = this.buildServiceEnv(preflight);
		const spawnEnv = { ...process.env, ...env };
		const resolved = resolveSpawnCommandAndEnv(preflight.mcpCommand, spawnEnv);
		if (resolved.command === "node") {
			throw new Error(nodeNotFoundMessage("MCP"));
		}

		return {
			command: resolved.command,
			args: preflight.mcpArgs,
			cwd: this.deps.getPluginDirRealpathOrNull(),
			env: resolved.env,
		};
	}

	private buildServiceEnv(preflight: StartupPreflight): Record<string, string> {
		const env: Record<string, string> = {
			OPENAI_API_KEY: preflight.openaiApiKey,
			OPENAI_EMBEDDING_MODEL:
				preflight.settings.openaiEmbeddingModel.trim() ||
				DEFAULT_SETTINGS.openaiEmbeddingModel,
			AILSS_VAULT_PATH: preflight.vaultPath,
			AILSS_MCP_HTTP_HOST: preflight.host,
			AILSS_MCP_HTTP_PORT: String(preflight.port),
			AILSS_MCP_HTTP_PATH: "/mcp",
			AILSS_MCP_HTTP_TOKEN: preflight.token,
			AILSS_MCP_HTTP_SHUTDOWN_TOKEN: preflight.shutdownToken,
			AILSS_GET_CONTEXT_DEFAULT_TOP_K: String(preflight.topK),
		};

		if (preflight.settings.mcpHttpServiceEnableWriteTools) {
			env.AILSS_ENABLE_WRITE_TOOLS = "1";
		}

		return env;
	}

	private resetStartupState(): void {
		this.liveStdout = "";
		this.liveStderr = "";
		this.startedAt = nowIso();
		this.lastExitCode = null;
		this.lastStoppedAt = null;
		this.lastErrorMessage = null;
		this.initializeDurableLog();
	}

	private initializeDurableLog(): void {
		const vaultPath = this.deps.getVaultPath().trim();
		if (!vaultPath) {
			this.durableLogPath = null;
			this.durableLogWriteQueue = Promise.resolve();
			return;
		}

		const dir = path.join(vaultPath, MCP_HTTP_LOG_DIR);
		const filePath = path.join(dir, MCP_HTTP_LOG_FILE);
		this.durableLogPath = filePath;
		this.durableLogWriteQueue = Promise.resolve();

		const header = [`[time] ${nowIso()}`, "[event] mcp-http-service-start", ""].join("\n");
		this.enqueueDurableLogWrite(async () => {
			await fs.promises.mkdir(dir, { recursive: true });
			await fs.promises.writeFile(filePath, header, "utf8");
		});
	}

	private enqueueDurableLogWrite(task: () => Promise<void>): void {
		this.durableLogWriteQueue = this.durableLogWriteQueue.then(task).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[ailss-mcp-http] durable log write failed: ${message}`);
		});
	}

	private appendDurableLogChunk(stream: "stdout" | "stderr", chunk: string): void {
		const filePath = this.durableLogPath;
		if (!filePath || !chunk) return;

		const content = chunk.trimEnd();
		if (!content) return;

		const entry = [`[time] ${nowIso()}`, `[stream] ${stream}`, content, ""].join("\n");
		this.enqueueDurableLogWrite(async () => {
			await fs.promises.appendFile(filePath, entry, "utf8");
		});
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
		const stderr = this.liveStderr.trim();
		const stderrTail = stderr ? stderr.split(/\r?\n/).slice(-10).join("\n").trim() : "";
		const suffix = code === null ? `signal ${signal}` : `exit ${code}`;
		const logHint = this.durableLogPath ? `\nMCP log file: ${this.durableLogPath}` : "";
		return stderrTail
			? `Unexpected stop (${suffix}). Last stderr:\n${stderrTail}${logHint}`
			: `Unexpected stop (${suffix}).${logHint}`;
	}

	private async requestShutdown(options: {
		host: string;
		port: number;
		tokens: string[];
	}): Promise<boolean> {
		const tokens = Array.from(
			new Set(options.tokens.map((t) => t.trim()).filter((t) => t.length > 0)),
		);
		if (tokens.length === 0) return false;

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (!token) continue;

			const res = await this.requestShutdownOnce({
				host: options.host,
				port: options.port,
				token,
			});

			if (res.ok) return true;
			if (res.status === 401 && i < tokens.length - 1) continue;
			return false;
		}

		return false;
	}

	private async requestShutdownOnce(options: {
		host: string;
		port: number;
		token: string;
	}): Promise<{ ok: boolean; status: number | null }> {
		// Use Node's HTTP client instead of `fetch` to avoid CORS/preflight issues in the
		// Obsidian renderer context.
		return await new Promise<{ ok: boolean; status: number | null }>((resolve) => {
			let settled = false;

			const finish = (ok: boolean, status: number | null, errorMessage?: string) => {
				if (settled) return;
				settled = true;

				if (errorMessage) {
					this.lastErrorMessage = errorMessage;
					this.deps.onStatusChanged();
				}

				resolve({ ok, status });
			};

			const req = http.request(
				{
					hostname: options.host,
					port: options.port,
					path: "/__ailss/shutdown",
					method: "POST",
					headers: {
						Authorization: `Bearer ${options.token}`,
					},
				},
				(res) => {
					res.setEncoding("utf8");

					let body = "";
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.on("end", () => {
						const status = res.statusCode ?? 0;
						if (status >= 200 && status < 300) {
							finish(true, status);
							return;
						}

						const message =
							status === 401
								? "Port is in use and shutdown was unauthorized (token mismatch)."
								: status === 404
									? "Port is in use and the service does not support remote shutdown."
									: `Port is in use and shutdown failed (HTTP ${status}).`;
						const detail = body.trim();
						finish(false, status, detail ? `${message}\n${detail}` : message);
					});
				},
			);

			req.setTimeout(1_500, () => {
				req.destroy(new Error("Request timed out."));
			});

			req.on("error", (error) => {
				const e = error as { message?: string; code?: string };
				const suffix = e.code ? `${e.code}: ` : "";
				const message = `${suffix}${e.message ?? String(error)}`;
				finish(false, null, `Port is in use and shutdown request failed: ${message}`);
			});

			req.end();
		});
	}
}
