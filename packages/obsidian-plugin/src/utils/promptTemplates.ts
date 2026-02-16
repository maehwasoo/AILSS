import operationalPrompt from "../../../../docs/standards/vault/prompt-operational.md";

export type PromptKind = "AGENTS" | "CLAUDE" | "GEMINI";

export function promptFilename(kind: PromptKind): string {
	if (kind === "AGENTS") return "AGENTS.md";
	if (kind === "CLAUDE") return "CLAUDE.md";
	return "GEMINI.md";
}

function normalizeMarkdown(text: string): string {
	// Normalize line endings for predictable vault writes across OSes.
	return (text ?? "").replace(/\r\n/g, "\n").trimEnd();
}

export function promptTemplate(_kind: PromptKind): string {
	const parts = [operationalPrompt]
		.map(normalizeMarkdown)
		.map((part) => part.trim())
		.filter(Boolean);

	return parts.join("\n\n---\n\n").trimEnd() + "\n";
}
