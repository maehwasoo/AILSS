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

	// This is intentionally explicit (but still tool-centric) so assistants consistently:
	// - Ground answers in the vault (SSOT)
	// - Use MCP tools correctly
	// - Follow safe write patterns for note edits
	const body = [
		"",
		"## What AILSS is",
		"",
		"- **AILSS** = **Actionable Integrated Linked Semantic System**.",
		"- This Obsidian vault is the **SSOT** (Single Source of Truth): treat notes as authoritative.",
		"- Use the AILSS **MCP** tools (Model Context Protocol: tool-calling interface) to ground work in real notes.",
		"",
		"## Non-negotiables",
		"",
		"- **Retrieval-first**: if a task might depend on vault knowledge, retrieve relevant notes before answering.",
		"- **No fabrication**: do not invent facts not present in notes; if missing, say so and propose where to record it.",
		"- **Safe writes only**: never write unless the user explicitly asks; preview with `apply=false`, then apply with `apply=true` only after confirmation.",
		"- **Minimal, auditable edits**: prefer small patch ops; avoid mass rewrites without explicit request.",
		"- **No secrets**: never echo tokens/API keys or private `.obsidian/**` details into chat.",
		"",
		"## Default workflow (tools, in order)",
		"",
		"0) If you are unsure what tools exist or which args to pass: call `tools/list` and follow the returned schemas exactly.",
		"1) **Context**: call `get_context` for any request that might depend on vault knowledge.",
		"2) **Exact text/fields**: call `read_note` when you need exact wording or frontmatter (don’t guess).",
		"3) **Relationships**: call `get_typed_links` to navigate typed-link relations (incoming + outgoing, up to 2 hops).",
		"4) **Paths**: call `get_vault_tree` when you need folder structure or an exact note path.",
		"5) **Health checks**: call `frontmatter_validate` to audit required frontmatter keys + `id`/`created` consistency.",
		"",
		"## Frontmatter schema (keys must exist)",
		"",
		"Every note should have YAML frontmatter with these keys (values may be empty):",
		"",
		"- `id` (14 digits) — must match `created` timestamp (`YYYYMMDDHHmmss`)",
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
		"### Recommended value conventions",
		"",
		"- `layer`: one of `strategic`, `conceptual`, `logical`, `physical`, `operational`",
		"  - `strategic`: why/vision/principles/roadmap",
		"  - `conceptual`: definitions/concepts/principles (tool-agnostic)",
		"  - `logical`: structure/architecture/models/flows (implementation-independent)",
		"  - `physical`: concrete implementation details (repos/files/config/versions)",
		"  - `operational`: runtime/ops/incidents/deployments/logs (time/event-driven)",
		"- `status`: one of `draft`, `in-review`, `published`, `archived`",
		"- `tags` / `keywords`: prefer short, stable tokens; avoid duplicates and overly-specific variants",
		"",
		"### Inbox tagging rule",
		"",
		"- Only add the `inbox` tag when the note lives under your inbox folder (e.g. `100. Inbox/`).",
		"",
		"## Wikilinks / Obsidian link forms",
		"",
		"- Treat these as valid forms and do not “simplify” them incorrectly:",
		"  - `[[Title]]`",
		"  - `[[Folder/Note]]`",
		"  - `[[Folder/Note|Title]]`",
		"- Prefer typed links (frontmatter relations) for meaning; use wikilinks freely in the body.",
		"- When you need an exact path, use `get_vault_tree` rather than guessing.",
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
		"- `new_note(...)` — create a new note with full frontmatter (default: no overwrite)",
		"- `capture_note(...)` — create a new note from provided content",
		"- `edit_note(...)` — line-based patch ops; prefer `apply=false` preview first",
		"- `relocate_note(...)` — move/rename notes",
		"- `reindex_paths(...)` — manually request reindex for paths (if exposed)",
		"",
		"## Creating notes",
		"",
		"- New notes must be `.md`.",
		"- Prefer `capture_note` (inbox) or `new_note` (explicit path) so required frontmatter keys exist and `id` matches `created`.",
		"- Do a dry-run first (`apply=false`), then ask for confirmation before `apply=true`.",
		"- Keep the body structured: short summary, key points, decisions, next actions/open questions, relevant wikilinks.",
		"- For inbox notes: add the `inbox` tag only if the note path is under the inbox folder.",
		"",
		"### Utilities",
		"- `frontmatter_validate(...)` — scan the vault for missing/broken frontmatter",
		"",
		"## Editing safety",
		"",
		"- Never write unless the user explicitly asks and confirms `apply=true`.",
		"- When editing note content (or relocating/renaming), also update frontmatter `updated` in the same change.",
		"",
	].join("\n");

	return `${header}${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
