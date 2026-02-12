import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/utils/tcp.js", () => ({
	waitForTcpPortToBeAvailable: vi.fn(),
}));

import {
	McpHttpServiceController,
	type McpHttpServiceControllerDeps,
} from "../../src/mcp/mcpHttpServiceController.js";
import { waitForTcpPortToBeAvailable } from "../../src/utils/tcp.js";

type TestSettings = ReturnType<McpHttpServiceControllerDeps["getSettings"]>;

type ControllerInternals = {
	prepareStartupPreflight: () => Promise<unknown>;
	normalizeStartupSettings: (settings: TestSettings) => Promise<{ port: number; topK: number }>;
	negotiatePortAvailability: (options: {
		host: string;
		port: number;
		tokens: string[];
	}) => Promise<{
		available: boolean;
		shutdownAttempted: boolean;
		shutdownSucceeded: boolean;
	}>;
	composePortInUseErrorMessage: (options: {
		host: string;
		port: number;
		shutdownAttempted: boolean;
		shutdownSucceeded: boolean;
	}) => string;
	requestShutdown: (options: {
		host: string;
		port: number;
		tokens: string[];
	}) => Promise<boolean>;
	resetStartupState: () => void;
	appendDurableLogChunk: (stream: "stdout" | "stderr", chunk: string) => void;
	durableLogWriteQueue: Promise<void>;
	lastErrorMessage: string | null;
};

function asInternals(controller: McpHttpServiceController): ControllerInternals {
	return controller as unknown as ControllerInternals;
}

function createSettings(overrides: Partial<TestSettings> = {}): TestSettings {
	return {
		openaiApiKey: "sk-test",
		openaiEmbeddingModel: "text-embedding-3-large",
		topK: 10,
		mcpCommand: "pnpm",
		mcpArgs: ["--filter", "@ailss/mcp", "exec", "node", "dist/http.js"],
		mcpHttpServiceEnabled: false,
		mcpHttpServicePort: 31415,
		mcpHttpServiceToken: "service-token",
		mcpHttpServiceShutdownToken: "shutdown-token",
		mcpHttpServiceEnableWriteTools: false,
		indexerCommand: "pnpm",
		indexerArgs: [],
		autoIndexEnabled: false,
		autoIndexDebounceMs: 5000,
		...overrides,
	};
}

function createController(
	options: {
		settings?: TestSettings;
		resolveMcpHttpArgs?: () => string[];
		vaultPath?: string;
	} = {},
) {
	const settings = options.settings ?? createSettings();
	const saveSettings = vi.fn(async () => {});
	const onStatusChanged = vi.fn();

	const deps: McpHttpServiceControllerDeps = {
		getSettings: () => settings,
		saveSettings,
		getVaultPath: () => options.vaultPath ?? "/vault",
		getPluginDirRealpathOrNull: () => "/plugin",
		resolveMcpHttpArgs: options.resolveMcpHttpArgs ?? (() => settings.mcpArgs),
		getUrl: () => "http://127.0.0.1:31415/mcp",
		onStatusChanged,
	};

	return {
		controller: new McpHttpServiceController(deps),
		saveSettings,
		onStatusChanged,
	};
}

describe("McpHttpServiceController startup helper unit branches", () => {
	const waitForPort = vi.mocked(waitForTcpPortToBeAvailable);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("prepareStartupPreflight validation branches", () => {
		it("throws when service token is missing", async () => {
			const { controller } = createController({
				settings: createSettings({ mcpHttpServiceToken: "   " }),
			});

			await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
				"Missing MCP service token.",
			);
		});

		it("throws when shutdown token is missing", async () => {
			const { controller } = createController({
				settings: createSettings({ mcpHttpServiceShutdownToken: "   " }),
			});

			await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
				"Missing MCP shutdown token.",
			);
		});

		it("throws when OpenAI API key is missing", async () => {
			const { controller } = createController({
				settings: createSettings({ openaiApiKey: "   " }),
			});

			await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
				"Missing OpenAI API key. Set it in Settings \u2192 Community plugins \u2192 AILSS Obsidian.",
			);
		});

		it("throws when MCP command/args are not resolvable", async () => {
			const { controller } = createController({
				settings: createSettings({ mcpCommand: "   " }),
				resolveMcpHttpArgs: () => [],
			});

			await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
				"Missing MCP HTTP server args. Build @ailss/mcp and ensure dist/http.js exists (or configure the MCP server path in settings).",
			);
		});
	});

	describe("normalizeStartupSettings clamp + save branches", () => {
		it("does not save when port and topK are already normalized", async () => {
			const settings = createSettings({
				mcpHttpServicePort: 31415,
				topK: 10,
			});
			const { controller, saveSettings } = createController({ settings });

			await expect(
				asInternals(controller).normalizeStartupSettings(settings),
			).resolves.toEqual({
				port: 31415,
				topK: 10,
			});
			expect(saveSettings).not.toHaveBeenCalled();
		});

		it("clamps out-of-range port and saves settings once", async () => {
			const settings = createSettings({
				mcpHttpServicePort: 70000,
				topK: 10,
			});
			const { controller, saveSettings } = createController({ settings });

			await expect(
				asInternals(controller).normalizeStartupSettings(settings),
			).resolves.toEqual({
				port: 31415,
				topK: 10,
			});
			expect(settings.mcpHttpServicePort).toBe(31415);
			expect(saveSettings).toHaveBeenCalledTimes(1);
		});

		it("clamps out-of-range topK and saves settings once", async () => {
			const settings = createSettings({
				mcpHttpServicePort: 31415,
				topK: 80,
			});
			const { controller, saveSettings } = createController({ settings });

			await expect(
				asInternals(controller).normalizeStartupSettings(settings),
			).resolves.toEqual({
				port: 31415,
				topK: 50,
			});
			expect(settings.topK).toBe(50);
			expect(saveSettings).toHaveBeenCalledTimes(1);
		});

		it("clamps both port and topK and saves twice", async () => {
			const settings = createSettings({
				mcpHttpServicePort: 0,
				topK: 0,
			});
			const { controller, saveSettings } = createController({ settings });

			await expect(
				asInternals(controller).normalizeStartupSettings(settings),
			).resolves.toEqual({
				port: 31415,
				topK: 1,
			});
			expect(settings.mcpHttpServicePort).toBe(31415);
			expect(settings.topK).toBe(1);
			expect(saveSettings).toHaveBeenCalledTimes(2);
		});
	});

	describe("negotiatePortAvailability branches", () => {
		it("returns available when the port is already free", async () => {
			const { controller } = createController();
			const internals = asInternals(controller);
			const requestShutdown = vi.fn(async () => true);
			internals.requestShutdown = requestShutdown;
			waitForPort.mockResolvedValueOnce(true);

			const result = await internals.negotiatePortAvailability({
				host: "127.0.0.1",
				port: 31415,
				tokens: ["shutdown-token", "service-token"],
			});

			expect(result).toEqual({
				available: true,
				shutdownAttempted: false,
				shutdownSucceeded: false,
			});
			expect(requestShutdown).not.toHaveBeenCalled();
			expect(waitForPort).toHaveBeenCalledTimes(1);
		});

		it("attempts shutdown and re-checks when first port check fails but shutdown succeeds", async () => {
			const { controller } = createController();
			const internals = asInternals(controller);
			const requestShutdown = vi.fn(async () => true);
			internals.requestShutdown = requestShutdown;
			waitForPort.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

			const result = await internals.negotiatePortAvailability({
				host: "127.0.0.1",
				port: 31415,
				tokens: ["shutdown-token", "service-token"],
			});

			expect(result).toEqual({
				available: true,
				shutdownAttempted: true,
				shutdownSucceeded: true,
			});
			expect(requestShutdown).toHaveBeenCalledTimes(1);
			expect(waitForPort).toHaveBeenCalledTimes(2);
		});

		it("returns unavailable when shutdown attempt fails", async () => {
			const { controller } = createController();
			const internals = asInternals(controller);
			const requestShutdown = vi.fn(async () => false);
			internals.requestShutdown = requestShutdown;
			waitForPort.mockResolvedValueOnce(false);

			const result = await internals.negotiatePortAvailability({
				host: "127.0.0.1",
				port: 31415,
				tokens: ["shutdown-token", "service-token"],
			});

			expect(result).toEqual({
				available: false,
				shutdownAttempted: true,
				shutdownSucceeded: false,
			});
			expect(requestShutdown).toHaveBeenCalledTimes(1);
			expect(waitForPort).toHaveBeenCalledTimes(1);
		});
	});

	describe("startup message composition branches", () => {
		it("prefixes prior shutdown failure detail when available", () => {
			const { controller } = createController();
			const internals = asInternals(controller);
			internals.lastErrorMessage = "Port is in use and shutdown was unauthorized.";

			const message = internals.composePortInUseErrorMessage({
				host: "127.0.0.1",
				port: 31415,
				shutdownAttempted: true,
				shutdownSucceeded: false,
			});

			expect(message).toBe(
				"Port is in use and shutdown was unauthorized.\n\nPort 31415 is already in use (127.0.0.1). Stop the process using it, or change the port in settings.",
			);
		});

		it("returns base message when no prior shutdown detail should be attached", () => {
			const { controller } = createController();
			const internals = asInternals(controller);
			internals.lastErrorMessage = "Port is in use and shutdown request failed.";

			const message = internals.composePortInUseErrorMessage({
				host: "127.0.0.1",
				port: 31415,
				shutdownAttempted: false,
				shutdownSucceeded: false,
			});

			expect(message).toBe(
				"Port 31415 is already in use (127.0.0.1). Stop the process using it, or change the port in settings.",
			);
		});
	});

	describe("durable log persistence", () => {
		it("writes stdout/stderr chunks to a vault log file", async () => {
			const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), "ailss-mcp-log-"));

			try {
				const { controller } = createController({ vaultPath });
				const internals = asInternals(controller);
				internals.resetStartupState();

				internals.appendDurableLogChunk("stdout", "service ready\n");
				internals.appendDurableLogChunk("stderr", "decode failure\n");
				await internals.durableLogWriteQueue;

				const logPath = path.join(vaultPath, ".ailss", "ailss-mcp-http-last.log");
				const content = await fs.readFile(logPath, "utf8");
				expect(content).toContain("[event] mcp-http-service-start");
				expect(content).toContain("[stream] stdout");
				expect(content).toContain("service ready");
				expect(content).toContain("[stream] stderr");
				expect(content).toContain("decode failure");
			} finally {
				await fs.rm(vaultPath, { recursive: true, force: true });
			}
		});
	});
});
