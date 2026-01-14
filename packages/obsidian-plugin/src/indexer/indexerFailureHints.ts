export function getIndexerFailureHint(message: string): string | null {
	const msg = message.toLowerCase();

	if (msg.includes("sqlite_cantopen") || msg.includes("unable to open database file")) {
		return "SQLite DB open failed: ensure <vault>/.ailss/ is writable and not locked. Fix: Settings → AILSS Obsidian → Index maintenance → Reset index DB (then reindex).";
	}

	if (msg.includes("dimension mismatch") && msg.includes("embedding")) {
		return "Embedding model mismatch: reset the index DB (Settings → AILSS Obsidian → Index maintenance) or switch the embedding model back to the one used when the DB was created.";
	}

	if (msg.includes("missed comma between flow collection entries")) {
		return 'YAML frontmatter parse error: if you have unquoted Obsidian wikilinks in frontmatter lists (e.g. `- [[Some Note]]`), quote them: `- "[[Some Note]]"`. Use the indexer log to see which file was being indexed.';
	}

	return null;
}
