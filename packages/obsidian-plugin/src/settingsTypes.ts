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
	indexerCommand: string;
	indexerArgs: string[];
	autoIndexEnabled: boolean;
	autoIndexDebounceMs: number;
}

export const DEFAULT_SETTINGS: AilssObsidianSettings = {
	openaiApiKey: "",
	openaiEmbeddingModel: "text-embedding-3-large",
	topK: 10,
	mcpCommand: "node",
	mcpArgs: [],
	mcpHttpServiceEnabled: false,
	mcpHttpServicePort: 31415,
	mcpHttpServiceToken: "",
	mcpHttpServiceShutdownToken: "",
	mcpHttpServiceEnableWriteTools: false,
	indexerCommand: "node",
	indexerArgs: [],
	autoIndexEnabled: false,
	autoIndexDebounceMs: 5000,
};
