import { DEFAULT_SETTINGS } from "../../settings.js";
import { nodeNotFoundMessage, resolveSpawnCommandAndEnv } from "../../utils/spawn.js";

import { type StartupPreflight } from "./preflight.js";

export type SpawnPlan = {
	command: string;
	args: string[];
	cwd: string | null;
	env: NodeJS.ProcessEnv;
};

export function buildSpawnPlan(options: {
	preflight: StartupPreflight;
	cwd: string | null;
}): SpawnPlan {
	const env = buildServiceEnv(options.preflight);
	const spawnEnv = { ...process.env, ...env };
	const resolved = resolveSpawnCommandAndEnv(options.preflight.mcpCommand, spawnEnv);
	if (resolved.command === "node") {
		throw new Error(nodeNotFoundMessage("MCP"));
	}

	return {
		command: resolved.command,
		args: options.preflight.mcpArgs,
		cwd: options.cwd,
		env: resolved.env,
	};
}

export function buildServiceEnv(preflight: StartupPreflight): Record<string, string> {
	const env: Record<string, string> = {
		OPENAI_API_KEY: preflight.openaiApiKey,
		OPENAI_EMBEDDING_MODEL:
			preflight.settings.openaiEmbeddingModel.trim() || DEFAULT_SETTINGS.openaiEmbeddingModel,
		AILSS_VAULT_PATH: preflight.vaultPath,
		AILSS_MCP_HTTP_HOST: preflight.host,
		AILSS_MCP_HTTP_PORT: String(preflight.port),
		AILSS_MCP_HTTP_PATH: "/mcp",
		AILSS_MCP_HTTP_TOKEN: preflight.token,
		AILSS_MCP_HTTP_SHUTDOWN_TOKEN: preflight.shutdownToken,
		AILSS_GET_CONTEXT_DEFAULT_TOP_K: String(preflight.topK),
	};

	if (preflight.settings.mcpHttpServiceEnableWriteTools) {
		env.AILSS_ENABLE_WRITE_TOOLS = "1";
	}

	return env;
}
