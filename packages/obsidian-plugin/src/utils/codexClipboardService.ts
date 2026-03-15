import { codexPrometheusAgentPrompt, codexSkillPrompt, type CodexSkillId } from "./codexPrompts.js";
import { writeTextToClipboard } from "./clipboard.js";

export function buildCodexMcpConfigBlock(options: { url: string; token: string }): string {
	return [
		"[mcp_servers.ailss]",
		`url = ${JSON.stringify(options.url)}`,
		`http_headers = { Authorization = ${JSON.stringify(`Bearer ${options.token}`)} }`,
		"",
	].join("\n");
}

export async function copyCodexMcpConfigBlockToClipboard(options: {
	url: string;
	token: string;
}): Promise<void> {
	await writeTextToClipboard(buildCodexMcpConfigBlock(options));
}

export async function copyCodexPrometheusAgentPromptToClipboard(): Promise<void> {
	await writeTextToClipboard(codexPrometheusAgentPrompt());
}

export async function copyCodexSkillPromptToClipboard(skillId: CodexSkillId): Promise<void> {
	await writeTextToClipboard(codexSkillPrompt(skillId));
}
