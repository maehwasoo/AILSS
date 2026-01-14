import type { AilssSemanticSearchHit } from "./ailssMcpClient.js";
import { AilssMcpClient } from "./ailssMcpClient.js";

import { DEFAULT_SETTINGS, type AilssObsidianSettings } from "../settings.js";
import { clampTopK } from "../utils/clamp.js";
import {
	nodeNotFoundMessage,
	resolveSpawnCommandAndEnv,
	toStringEnvRecord,
} from "../utils/spawn.js";

export type SemanticSearchServiceDeps = {
	getSettings: () => AilssObsidianSettings;
	getVaultPath: () => string;
	getPluginDirRealpathOrNull: () => string | null;
	resolveMcpArgs: () => string[];
};

export async function semanticSearchWithMcp(
	deps: SemanticSearchServiceDeps,
	query: string,
): Promise<AilssSemanticSearchHit[]> {
	const settings = deps.getSettings();
	const vaultPath = deps.getVaultPath();
	const openaiApiKey = settings.openaiApiKey.trim();
	if (!openaiApiKey) {
		throw new Error(
			"Missing OpenAI API key. Set it in Settings → Community plugins → AILSS Obsidian.",
		);
	}

	const mcpCommand = settings.mcpCommand.trim();
	const mcpArgs = deps.resolveMcpArgs();
	if (!mcpCommand || mcpArgs.length === 0) {
		throw new Error(
			"Missing MCP server command/args. Set it in settings (e.g. command=node, args=/abs/path/to/packages/mcp/dist/stdio.js).",
		);
	}

	// Env overrides for the spawned MCP server process
	const env: Record<string, string> = {
		OPENAI_API_KEY: openaiApiKey,
		OPENAI_EMBEDDING_MODEL:
			settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
		AILSS_VAULT_PATH: vaultPath,
	};

	const cwd = deps.getPluginDirRealpathOrNull();
	const spawnEnv = { ...process.env, ...env };
	const resolved = resolveSpawnCommandAndEnv(mcpCommand, spawnEnv);
	if (resolved.command === "node") {
		throw new Error(nodeNotFoundMessage("MCP"));
	}

	const client = new AilssMcpClient({
		command: resolved.command,
		args: mcpArgs,
		env: toStringEnvRecord(resolved.env),
		...(cwd ? { cwd } : {}),
	});

	try {
		return await client.semanticSearch(query, clampTopK(settings.topK));
	} finally {
		await client.close();
	}
}
