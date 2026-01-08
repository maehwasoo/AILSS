export type PromptKind = "AGENTS" | "CLAUDE" | "GEMINI";

export function promptFilename(kind: PromptKind): string {
	if (kind === "AGENTS") return "AGENTS.md";
	if (kind === "CLAUDE") return "CLAUDE.md";
	return "GEMINI.md";
}

export function promptTemplate(kind: PromptKind): string {
	const header =
		kind === "AGENTS"
			? "# AGENTS.md — AILSS system prompt\n"
			: kind === "CLAUDE"
				? "# CLAUDE.md — AILSS system prompt\n"
				: "# GEMINI.md — AILSS system prompt\n";

	// Intentionally short and tool-centric so it remains stable across assistants.
	// The vault itself is the SSOT; use MCP tools to ground responses in notes.
	const body = [
		"",
		"## AILSS vault rules (SSOT)",
		"",
		"- Treat this Obsidian vault as the Single Source of Truth (SSOT).",
		"- Do not invent facts not present in notes; if missing, propose where to add it.",
		"- Prefer typed links (frontmatter relations) for meaning; use wikilinks freely in body.",
		"",
		"## Frontmatter requirements (keys must exist)",
		"",
		"Every note should have YAML frontmatter with these keys (values may be empty):",
		"",
		"- `id` (14 digits) — must match `created` timestamp (YYYYMMDDHHmmss)",
		"- `created` (ISO seconds) — `YYYY-MM-DDTHH:mm:ss`",
		"- `title`",
		"- `summary`",
		"- `aliases`",
		"- `entity`",
		"- `layer`",
		"- `tags`",
		"- `keywords`",
		"- `status`",
		"- `updated` (ISO seconds)",
		"",
		"Typed-link fields (e.g. `depends_on`, `see_also`) are optional.",
		"",
		"## AILSS MCP tools (use these, in order)",
		"",
		"### Read",
		"- `get_context(query, top_k, max_chars_per_note)` — semantic retrieval + note previews",
		"- `get_typed_links(path, max_hops<=2, include_incoming/outgoing)` — typed-link graph expansion",
		"- `read_note(path, max_chars)` — read a specific note verbatim",
		"- `get_vault_tree(...)` — folder/file tree",
		"",
		"### Edit (explicit apply)",
		"- `capture_note(...)` — create a new note from provided content",
		"- `edit_note(...)` — line-based patch ops; prefer `apply=false` preview first",
		"- `relocate_note(...)` — move/rename notes",
		"",
		"### Utilities",
		"- `frontmatter_validate(...)` — scan the vault for missing/broken frontmatter",
		"",
		"## Editing safety",
		"",
		"- Never write unless the user explicitly asks and confirms `apply=true`.",
		"- When editing note content, also update frontmatter `updated` in the same change.",
		"",
	].join("\n");

	return `${header}${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
