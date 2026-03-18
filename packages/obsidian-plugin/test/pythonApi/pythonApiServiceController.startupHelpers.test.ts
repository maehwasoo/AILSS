import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/tcp.js", () => ({
	waitForTcpPortToBeAvailable: vi.fn(),
}));

vi.mock("../../src/pythonApi/client.js", () => ({
	requestPythonApiShutdown: vi.fn(),
	waitForPythonApiHealth: vi.fn(),
}));

import {
	PythonApiServiceController,
	type PythonApiServiceControllerDeps,
} from "../../src/pythonApi/pythonApiServiceController.js";
import { waitForPythonApiHealth } from "../../src/pythonApi/client.js";
import { waitForTcpPortToBeAvailable } from "../../src/utils/tcp.js";

type TestSettings = ReturnType<PythonApiServiceControllerDeps["getSettings"]>;
type StartupPreflight = {
	host: string;
	port: number;
	topK: number;
	command: string;
	args: string[];
	vaultPath: string;
	settings: TestSettings;
};

type ControllerInternals = {
	prepareStartupPreflight: () => Promise<StartupPreflight>;
	negotiatePortAvailability: (options: {
		host: string;
		port: number;
		tokens: string[];
	}) => Promise<{
		available: boolean;
		shutdownAttempted: boolean;
		shutdownSucceeded: boolean;
	}>;
	waitUntilHealthy: (preflight: StartupPreflight) => Promise<void>;
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
	lastErrorMessage: string | null;
};

function asInternals(controller: PythonApiServiceController): ControllerInternals {
	return controller as unknown as ControllerInternals;
}

function createSettings(overrides: Partial<TestSettings> = {}): TestSettings {
	return {
		openaiApiKey: "sk-test",
		openaiEmbeddingModel: "text-embedding-3-large",
		topK: 10,
		mcpCommand: "node",
		mcpArgs: [],
		mcpHttpServiceEnabled: false,
		mcpHttpServicePort: 31415,
		mcpHttpServiceToken: "service-token",
		mcpHttpServiceShutdownToken: "service-shutdown-token",
		mcpHttpServiceEnableWriteTools: false,
		pythonApiServiceEnabled: false,
		pythonApiServicePort: 8787,
		pythonApiServiceShutdownToken: "python-shutdown-token",
		pythonApiCommand: "uv",
		pythonApiArgs: ["run", "--directory", "apps/api", "ailss-api"],
		indexerCommand: "node",
		indexerArgs: [],
		autoIndexEnabled: false,
		autoIndexDebounceMs: 5000,
		...overrides,
	};
}

function createController(
	options: {
		settings?: TestSettings;
		resolvePythonApiArgs?: () => string[];
	} = {},
) {
	const settings = options.settings ?? createSettings();
	const saveSettings = vi.fn(async () => {});
	const onStatusChanged = vi.fn();

	const deps: PythonApiServiceControllerDeps = {
		getSettings: () => settings,
		saveSettings,
		getVaultPath: () => "/vault",
		getPluginDirRealpathOrNull: () => "/plugin",
		resolvePythonApiArgs: options.resolvePythonApiArgs ?? (() => settings.pythonApiArgs),
		getUrl: () => "http://127.0.0.1:8787",
		onStatusChanged,
	};

	return {
		controller: new PythonApiServiceController(deps),
		saveSettings,
		onStatusChanged,
	};
}

describe("PythonApiServiceController startup helper branches", () => {
	const waitForPort = vi.mocked(waitForTcpPortToBeAvailable);
	const waitForHealth = vi.mocked(waitForPythonApiHealth);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when Python shutdown token is missing", async () => {
		const { controller } = createController({
			settings: createSettings({ pythonApiServiceShutdownToken: "   " }),
		});

		await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
			"Missing Python backend shutdown token.",
		);
	});

	it("throws when Python command or args are not resolvable", async () => {
		const { controller } = createController({
			settings: createSettings({ pythonApiCommand: "   " }),
			resolvePythonApiArgs: () => [],
		});

		await expect(asInternals(controller).prepareStartupPreflight()).rejects.toThrow(
			"Missing Python API args. Ensure apps/api exists or configure the Python backend command + args in settings.",
		);
	});

	it("falls back to the Python default port and persists the normalized setting", async () => {
		const settings = createSettings({ pythonApiServicePort: 70000 });
		const { controller, saveSettings } = createController({ settings });

		await expect(asInternals(controller).prepareStartupPreflight()).resolves.toMatchObject({
			port: 8787,
			topK: 10,
		});
		expect(settings.pythonApiServicePort).toBe(8787);
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it("caps the Python default top_k without mutating the shared plugin setting", async () => {
		const settings = createSettings({ topK: 80 });
		const { controller, saveSettings } = createController({ settings });

		await expect(asInternals(controller).prepareStartupPreflight()).resolves.toMatchObject({
			port: 8787,
			topK: 20,
		});
		expect(settings.topK).toBe(80);
		expect(saveSettings).not.toHaveBeenCalled();
	});

	it("waits long enough for Python uv cold starts during readiness checks", async () => {
		const { controller } = createController();
		const internals = asInternals(controller);
		const preflight = await internals.prepareStartupPreflight();
		waitForHealth.mockResolvedValue({
			status: "ok",
			service: "ailss-api",
			version: "0.1.0-dev",
			checks: {},
		});

		await expect(internals.waitUntilHealthy(preflight)).resolves.toBeUndefined();
		expect(waitForHealth).toHaveBeenCalledWith({
			host: "127.0.0.1",
			port: 8787,
			timeoutMs: 30_000,
			pollIntervalMs: 150,
		});
	});

	it("returns available when the Python port is already free", async () => {
		const { controller } = createController();
		const internals = asInternals(controller);
		const requestShutdown = vi.fn(async () => true);
		internals.requestShutdown = requestShutdown;
		waitForPort.mockResolvedValueOnce(true);

		const result = await internals.negotiatePortAvailability({
			host: "127.0.0.1",
			port: 8787,
			tokens: ["python-shutdown-token"],
		});

		expect(result).toEqual({
			available: true,
			shutdownAttempted: false,
			shutdownSucceeded: false,
		});
		expect(requestShutdown).not.toHaveBeenCalled();
	});

	it("attempts shutdown and re-checks when the Python port is occupied", async () => {
		const { controller } = createController();
		const internals = asInternals(controller);
		const requestShutdown = vi.fn(async () => true);
		internals.requestShutdown = requestShutdown;
		waitForPort.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		const result = await internals.negotiatePortAvailability({
			host: "127.0.0.1",
			port: 8787,
			tokens: ["python-shutdown-token"],
		});

		expect(result).toEqual({
			available: true,
			shutdownAttempted: true,
			shutdownSucceeded: true,
		});
		expect(requestShutdown).toHaveBeenCalledTimes(1);
		expect(waitForPort).toHaveBeenCalledTimes(2);
	});

	it("prefixes shutdown failure detail into the port-in-use error", () => {
		const { controller } = createController();
		const internals = asInternals(controller);
		internals.lastErrorMessage = "Port is in use and Python shutdown was unauthorized.";

		const message = internals.composePortInUseErrorMessage({
			host: "127.0.0.1",
			port: 8787,
			shutdownAttempted: true,
			shutdownSucceeded: false,
		});

		expect(message).toBe(
			"Port is in use and Python shutdown was unauthorized.\n\nPython backend port 8787 is already in use (127.0.0.1). Stop the process using it, or change the Python backend port in settings.",
		);
	});
});
