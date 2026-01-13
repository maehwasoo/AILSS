import { Notice } from "obsidian";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";

import { DEFAULT_SETTINGS, type AilssObsidianSettings } from "../settings.js";
import { clampPort } from "../utils/clamp.js";
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

export class McpHttpServiceController {
	private proc: ChildProcess | null = null;
	private stopRequested = false;
	private liveStdout = "";
	private liveStderr = "";
	private startedAt: string | null = null;
	private lastExitCode: number | null = null;
	private lastStoppedAt: string | null = null;
	private lastErrorMessage: string | null = null;

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
			const settings = this.deps.getSettings();
			const token = settings.mcpHttpServiceToken.trim();
			if (!token) {
				throw new Error("Missing MCP service token.");
			}

			const vaultPath = this.deps.getVaultPath();
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

			const port = clampPort(settings.mcpHttpServicePort);
			if (port !== settings.mcpHttpServicePort) {
				settings.mcpHttpServicePort = port;
				await this.deps.saveSettings();
			}

			const host = "127.0.0.1";
			let portAvailable = await waitForTcpPortToBeAvailable({
				host,
				port,
				timeoutMs: 3_000,
			});
			let shutdownAttempted = false;
			let shutdownSucceeded = false;

			if (!portAvailable) {
				shutdownAttempted = true;
				const shutdownOk = await this.requestShutdown({ host, port, token });
				shutdownSucceeded = shutdownOk;

				if (shutdownOk) {
					portAvailable = await waitForTcpPortToBeAvailable({
						host,
						port,
						timeoutMs: 5_000,
					});
				}
			}

			if (!portAvailable) {
				const baseMessage = `Port ${port} is already in use (${host}). Stop the process using it, or change the port in settings.`;
				const message =
					shutdownAttempted && !shutdownSucceeded && this.lastErrorMessage
						? `${this.lastErrorMessage}\n\n${baseMessage}`
						: baseMessage;

				this.lastErrorMessage = message;
				new Notice(`AILSS MCP service failed: ${message}`);
				this.deps.onStatusChanged();
				return;
			}

			const env: Record<string, string> = {
				OPENAI_API_KEY: openaiApiKey,
				OPENAI_EMBEDDING_MODEL:
					settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
				AILSS_VAULT_PATH: vaultPath,
				AILSS_MCP_HTTP_HOST: host,
				AILSS_MCP_HTTP_PORT: String(port),
				AILSS_MCP_HTTP_PATH: "/mcp",
				AILSS_MCP_HTTP_TOKEN: token,
			};

			if (settings.mcpHttpServiceEnableWriteTools) {
				env.AILSS_ENABLE_WRITE_TOOLS = "1";
			}

			const cwd = this.deps.getPluginDirRealpathOrNull();
			const spawnEnv = { ...process.env, ...env };
			const resolved = resolveSpawnCommandAndEnv(mcpCommand, spawnEnv);
			if (resolved.command === "node") {
				throw new Error(nodeNotFoundMessage("MCP"));
			}

			this.liveStdout = "";
			this.liveStderr = "";
			this.startedAt = nowIso();
			this.lastExitCode = null;
			this.lastStoppedAt = null;
			this.lastErrorMessage = null;

			const child = spawn(resolved.command, mcpArgs, {
				stdio: ["ignore", "pipe", "pipe"],
				...(cwd ? { cwd } : {}),
				env: resolved.env,
			});

			this.proc = child;
			this.deps.onStatusChanged();

			child.stdout?.on("data", (chunk: unknown) => {
				const text = typeof chunk === "string" ? chunk : String(chunk);
				this.liveStdout = appendLimited(this.liveStdout, text, 40_000);
			});

			child.stderr?.on("data", (chunk: unknown) => {
				const text = typeof chunk === "string" ? chunk : String(chunk);
				this.liveStderr = appendLimited(this.liveStderr, text, 40_000);
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
					const stderr = this.liveStderr.trim();
					const stderrTail = stderr
						? stderr.split(/\r?\n/).slice(-10).join("\n").trim()
						: "";
					const suffix = code === null ? `signal ${signal}` : `exit ${code}`;
					this.lastErrorMessage = stderrTail
						? `Unexpected stop (${suffix}). Last stderr:\n${stderrTail}`
						: `Unexpected stop (${suffix}).`;
				} else {
					this.lastErrorMessage = null;
				}

				this.deps.onStatusChanged();

				if (this.deps.getSettings().mcpHttpServiceEnabled) {
					const suffix =
						code === null ? (signal ? ` (${signal})` : "") : ` (exit ${code})`;
					new Notice(`AILSS MCP service stopped${suffix}.`);
				}
			});

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

	private async requestShutdown(options: {
		host: string;
		port: number;
		token: string;
	}): Promise<boolean> {
		// Use Node's HTTP client instead of `fetch` to avoid CORS/preflight issues in the
		// Obsidian renderer context.
		return await new Promise<boolean>((resolve) => {
			let settled = false;

			const finish = (ok: boolean, errorMessage?: string) => {
				if (settled) return;
				settled = true;

				if (errorMessage) {
					this.lastErrorMessage = errorMessage;
					this.deps.onStatusChanged();
				}

				resolve(ok);
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
							finish(true);
							return;
						}

						const message =
							status === 401
								? "Port is in use and shutdown was unauthorized (token mismatch)."
								: status === 404
									? "Port is in use and the service does not support remote shutdown."
									: `Port is in use and shutdown failed (HTTP ${status}).`;
						const detail = body.trim();
						finish(false, detail ? `${message}\n${detail}` : message);
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
				finish(false, `Port is in use and shutdown request failed: ${message}`);
			});

			req.end();
		});
	}
}
