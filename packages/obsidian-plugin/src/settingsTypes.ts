export type CodexSkillId =
	| "ailss-agent"
	| "ailss-agent-ontology"
	| "ailss-agent-curator"
	| "ailss-agent-maintenance"
	| "ailss-prometheus-agent";

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
	codexSkillId: CodexSkillId;
	codexSkillsInstallRootDir: string;
	codexSkillsInstallOverwrite: boolean;
	codexSkillsInstallBackup: boolean;
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
	codexSkillId: "ailss-agent",
	codexSkillsInstallRootDir: "",
	codexSkillsInstallOverwrite: false,
	codexSkillsInstallBackup: true,
	indexerCommand: "node",
	indexerArgs: [],
	autoIndexEnabled: false,
	autoIndexDebounceMs: 5000,
};
