import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/tcp.js", () => ({
	waitForTcpPortToBeAvailable: vi.fn(),
}));

import {
	PythonApiServiceController,
	type PythonApiServiceControllerDeps,
} from "../../src/pythonApi/pythonApiServiceController.js";
import { waitForTcpPortToBeAvailable } from "../../src/utils/tcp.js";

type TestSettings = ReturnType<PythonApiServiceControllerDeps["getSettings"]>;

type ControllerInternals = {
	prepareStartupPreflight: () => Promise<unknown>;
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
