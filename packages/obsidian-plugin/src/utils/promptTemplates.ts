import assistantWorkflow from "../../../../docs/standards/vault/assistant-workflow.md";
import frontmatterSchema from "../../../../docs/standards/vault/frontmatter-schema.md";
import noteStyle from "../../../../docs/standards/vault/note-style.md";
import typedLinks from "../../../../docs/standards/vault/typed-links.md";
import vaultStructure from "../../../../docs/standards/vault/vault-structure.md";

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
	const parts = [assistantWorkflow, frontmatterSchema, typedLinks, vaultStructure, noteStyle]
		.map(normalizeMarkdown)
		.map((part) => part.trim())
		.filter(Boolean);

	return parts.join("\n\n---\n\n").trimEnd() + "\n";
}
