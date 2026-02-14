import { type AilssObsidianSettings } from "../../settings.js";
import { clampPort, clampTopK } from "../../utils/clamp.js";

export type StartupPreflight = {
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

export async function normalizeStartupSettings(options: {
	settings: AilssObsidianSettings;
	saveSettings: () => Promise<void>;
}): Promise<{
	port: number;
	topK: number;
}> {
	const port = clampPort(options.settings.mcpHttpServicePort);
	if (port !== options.settings.mcpHttpServicePort) {
		options.settings.mcpHttpServicePort = port;
		await options.saveSettings();
	}

	const topK = clampTopK(options.settings.topK);
	if (topK !== options.settings.topK) {
		options.settings.topK = topK;
		await options.saveSettings();
	}

	return { port, topK };
}

export async function prepareStartupPreflight(options: {
	getSettings: () => AilssObsidianSettings;
	saveSettings: () => Promise<void>;
	getVaultPath: () => string;
	resolveMcpHttpArgs: () => string[];
	normalizeStartupSettings: (
		settings: AilssObsidianSettings,
	) => Promise<{ port: number; topK: number }>;
}): Promise<StartupPreflight> {
	const settings = options.getSettings();
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
	const mcpArgs = options.resolveMcpHttpArgs();
	if (!mcpCommand || mcpArgs.length === 0) {
		throw new Error(
			"Missing MCP HTTP server args. Build @ailss/mcp and ensure dist/http.js exists (or configure the MCP server path in settings).",
		);
	}

	const { port, topK } = await options.normalizeStartupSettings(settings);
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
		vaultPath: options.getVaultPath(),
	};
}
