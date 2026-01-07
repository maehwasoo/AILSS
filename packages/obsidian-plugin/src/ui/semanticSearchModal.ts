import { App, Modal, Notice, Setting, TFile } from "obsidian";

import type AilssObsidianPlugin from "../main.js";
import type { AilssSemanticSearchHit } from "../mcp/ailssMcpClient.js";

export class AilssSemanticSearchModal extends Modal {
	private query = "";
	private statusEl: HTMLElement | null = null;
	private resultsEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly plugin: AilssObsidianPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ailss-obsidian");

		contentEl.createEl("h2", { text: "AILSS semantic search" });

		new Setting(contentEl)
			.setName("Query")
			.setDesc("Search your AILSS index using semantic similarity.")
			.addText((text) => {
				text.setPlaceholder("Ask a question or type a topic…");
				text.onChange((value) => {
					this.query = value;
				});

				text.inputEl.addEventListener("keydown", (event: unknown) => {
					if (!isEnterKeyEvent(event)) return;
					event.preventDefault();
					void this.runSearch();
				});
			})
			.addButton((button) => {
				button.setButtonText("Search");
				button.setCta();
				button.onClick(() => void this.runSearch());
			});

		this.statusEl = contentEl.createDiv({ cls: "ailss-status" });
		this.resultsEl = contentEl.createDiv({ cls: "ailss-results" });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private setStatus(text: string): void {
		if (!this.statusEl) return;
		this.statusEl.setText(text);
	}

	private renderResults(results: AilssSemanticSearchHit[]): void {
		if (!this.resultsEl) return;

		this.resultsEl.empty();
		if (results.length === 0) {
			this.resultsEl.createDiv({ text: "No results found." });
			return;
		}

		for (const hit of results) {
			const item = this.resultsEl.createDiv({ cls: "ailss-result" });
			const title = hit.heading ? `${hit.heading} — ${hit.path}` : hit.path;
			item.createDiv({ cls: "ailss-result-title", text: title });
			item.createDiv({ cls: "ailss-result-snippet", text: hit.snippet });

			item.addEventListener("click", () => void this.openResult(hit));
		}
	}

	private async openResult(hit: AilssSemanticSearchHit): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(hit.path);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${hit.path}`);
			return;
		}

		await this.app.workspace.getLeaf(true).openFile(file);
	}

	private async runSearch(): Promise<void> {
		const query = this.query.trim();
		if (!query) {
			new Notice("Enter a query first.");
			return;
		}

		this.setStatus("Searching…");
		this.renderResults([]);

		try {
			const results = await this.plugin.semanticSearch(query);
			this.renderResults(results);
			this.setStatus(`Results: ${results.length}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const hint = describeSearchFailureHint(message);
			this.setStatus("Search failed.");
			new Notice(`AILSS search failed: ${message}${hint ? `\n\n${hint}` : ""}`);
		}
	}
}

function isEnterKeyEvent(event: unknown): event is { key: "Enter"; preventDefault: () => void } {
	if (!event || typeof event !== "object") return false;
	const obj = event as { key?: unknown; preventDefault?: unknown };
	return obj.key === "Enter" && typeof obj.preventDefault === "function";
}

function describeSearchFailureHint(message: string): string | null {
	const msg = message.toLowerCase();

	if (msg.includes("sqlite_cantopen") || msg.includes("unable to open database file")) {
		return "SQLite DB open failed: ensure <vault>/.ailss/ is writable and not locked. Fix: run AILSS: Reindex vault (or reset the index DB in Settings → AILSS Obsidian).";
	}

	if (
		msg.includes("embedding config mismatch") ||
		(msg.includes("embedding") && msg.includes("mismatch"))
	) {
		return "Embedding config mismatch: reset the index DB (Settings → AILSS Obsidian → Index maintenance) or switch the embedding model back.";
	}

	return null;
}
