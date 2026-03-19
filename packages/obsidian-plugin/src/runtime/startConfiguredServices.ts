export function getMcpHttpServiceAutostartBlockReason(options: {
	mcpHttpServiceEnabled: boolean;
	openaiApiKey: string;
}): string | null {
	if (!options.mcpHttpServiceEnabled) {
		return null;
	}

	if (!options.openaiApiKey.trim()) {
		return "Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.";
	}

	return null;
}

export async function startConfiguredServices(options: {
	pythonApiServiceEnabled: boolean;
	mcpHttpServiceEnabled: boolean;
	startPythonApiService: () => Promise<void>;
	startMcpHttpService: () => Promise<void>;
}): Promise<void> {
	if (options.pythonApiServiceEnabled) {
		await options.startPythonApiService();
	}

	if (options.mcpHttpServiceEnabled) {
		await options.startMcpHttpService();
	}
}
