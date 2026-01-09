import prometheusAgent from "../../../../docs/ops/codex-skills/prometheus-agent/SKILL.md";

function normalizePromptText(text: string): string {
	// Normalize line endings for predictable clipboard copies across OSes.
	return (text ?? "").replace(/\r\n/g, "\n").trimEnd() + "\n";
}

export function codexPrometheusAgentPrompt(): string {
	return normalizePromptText(prometheusAgent);
}
