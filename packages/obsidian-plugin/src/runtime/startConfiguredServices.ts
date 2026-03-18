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
