export interface AilssObsidianSettings {
	openaiApiKey: string;
	openaiEmbeddingModel: string;
	topK: number;
	mcpCommand: string;
	mcpArgs: string[];
	mcpHttpServiceEnabled: boolean;
	mcpHttpServicePort: number;
	mcpHttpServiceToken: string;
	mcpHttpServiceShutdownToken: string;
	mcpHttpServiceEnableWriteTools: boolean;
	pythonApiServiceEnabled: boolean;
	pythonApiServicePort: number;
	pythonApiServiceShutdownToken: string;
	pythonApiCommand: string;
	pythonApiArgs: string[];
	indexerCommand: string;
	indexerArgs: string[];
	autoIndexEnabled: boolean;
	autoIndexDebounceMs: number;
}

export const DEFAULT_SETTINGS: AilssObsidianSettings = {
	openaiApiKey: "",
	openaiEmbeddingModel: "text-embedding-3-large",
	topK: 10,
	mcpCommand: "uv",
	mcpArgs: [],
	mcpHttpServiceEnabled: true,
	mcpHttpServicePort: 31415,
	mcpHttpServiceToken: "",
	mcpHttpServiceShutdownToken: "",
	mcpHttpServiceEnableWriteTools: false,
	pythonApiServiceEnabled: true,
	pythonApiServicePort: 8787,
	pythonApiServiceShutdownToken: "",
	pythonApiCommand: "uv",
	pythonApiArgs: [],
	indexerCommand: "uv",
	indexerArgs: [],
	autoIndexEnabled: false,
	autoIndexDebounceMs: 5000,
};
