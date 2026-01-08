import { Modal, Notice, Setting } from "obsidian";

import type AilssObsidianPlugin from "../main.js";
import type { AilssIndexerStatusSnapshot } from "../main.js";
import { formatAilssTimestampForUi } from "../utils/dateTime.js";

export class AilssIndexerStatusModal extends Modal {
	private unsubscribe: (() => void) | null = null;

	private statusTextEl: HTMLElement | null = null;
	private metaTextEl: HTMLElement | null = null;
	private progressEl: HTMLProgressElement | null = null;
	private progressTextEl: HTMLElement | null = null;
	private fileTextEl: HTMLElement | null = null;
	private chunkTextEl: HTMLElement | null = null;
	private summaryTextEl: HTMLElement | null = null;
	private outputArea: HTMLTextAreaElement | null = null;

	constructor(
		app: AilssObsidianPlugin["app"],
		private readonly plugin: AilssObsidianPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ailss-obsidian");

		contentEl.createEl("h2", { text: "AILSS indexing status" });

		this.statusTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.metaTextEl = contentEl.createDiv({ cls: "ailss-status" });

		this.progressEl = contentEl.createEl("progress");
		this.progressEl.max = 1;
		this.progressEl.value = 0;
		this.progressEl.style.width = "100%";
		this.progressEl.style.marginTop = "8px";

		this.progressTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.fileTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.chunkTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.summaryTextEl = contentEl.createDiv({ cls: "ailss-status" });

		contentEl.createEl("h3", { text: "Output (tail)" });
		this.outputArea = contentEl.createEl("textarea");
		this.outputArea.rows = 16;
		this.outputArea.style.width = "100%";
		this.outputArea.value = "";
		this.outputArea.readOnly = true;

		new Setting(contentEl)
			.setName("Actions")
			.addButton((button) => {
				button.setButtonText("Copy output");
				button.onClick(() => void this.copyToClipboard(this.outputArea?.value ?? ""));
			})
			.addButton((button) => {
				button.setButtonText("Show last logs");
				button.onClick(() => this.plugin.openLastIndexerLogModal());
			});

		this.unsubscribe = this.plugin.subscribeIndexerStatus((snapshot) => this.render(snapshot));
	}

	onClose(): void {
		if (this.unsubscribe) this.unsubscribe();
		this.unsubscribe = null;
		this.statusTextEl = null;
		this.metaTextEl = null;
		this.progressEl = null;
		this.progressTextEl = null;
		this.fileTextEl = null;
		this.chunkTextEl = null;
		this.summaryTextEl = null;
		this.outputArea = null;
		this.contentEl.empty();
	}

	private render(snapshot: AilssIndexerStatusSnapshot): void {
		if (this.statusTextEl) {
			this.statusTextEl.setText(statusLine(snapshot));
		}

		if (this.metaTextEl) {
			const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
			const lastFinishedAt = formatAilssTimestampForUi(snapshot.lastFinishedAt);
			const metaParts = [
				lastSuccessAt ? `Last success: ${lastSuccessAt}` : "Last success: (none)",
				lastFinishedAt
					? `Last attempt: ${lastFinishedAt}${snapshot.lastExitCode === null ? "" : ` (exit ${snapshot.lastExitCode})`}`
					: "Last attempt: (none)",
			];
			this.metaTextEl.setText(metaParts.join("\n"));
		}

		if (this.progressEl) {
			const total = snapshot.progress.filesTotal;
			if (!snapshot.running || total === null) {
				this.progressEl.style.display = "none";
			} else {
				this.progressEl.style.display = "";
				const done = snapshot.progress.filesProcessed;
				this.progressEl.max = Math.max(1, total);
				this.progressEl.value = Math.min(done, this.progressEl.max);
			}
		}

		if (this.progressTextEl) {
			if (!snapshot.running) {
				this.progressTextEl.setText("");
			} else {
				const total = snapshot.progress.filesTotal;
				const done = snapshot.progress.filesProcessed;
				this.progressTextEl.setText(
					total ? `Files: ${Math.min(done, total)}/${total}` : `Files processed: ${done}`,
				);
			}
		}

		if (this.fileTextEl) {
			const current = snapshot.progress.currentFile;
			this.fileTextEl.setText(
				snapshot.running
					? current
						? `Current: ${current}${snapshot.progress.currentMode ? ` (${snapshot.progress.currentMode})` : ""}`
						: "Current: (waiting for indexer output)"
					: "",
			);
		}

		if (this.chunkTextEl) {
			if (!snapshot.running) {
				this.chunkTextEl.setText("");
			} else if (snapshot.progress.chunkCurrent && snapshot.progress.chunkTotal) {
				this.chunkTextEl.setText(
					`Chunks: ${snapshot.progress.chunkCurrent}/${snapshot.progress.chunkTotal}`,
				);
			} else {
				this.chunkTextEl.setText("");
			}
		}

		if (this.summaryTextEl) {
			const summary = snapshot.progress.summary;
			if (!summary) {
				this.summaryTextEl.setText("");
			} else {
				this.summaryTextEl.setText(
					`Summary: changedFiles=${summary.changedFiles}, indexedChunks=${summary.indexedChunks}, deletedFiles=${summary.deletedFiles}`,
				);
			}
		}

		if (this.outputArea) {
			const combined = [
				"[stdout]",
				snapshot.liveLog.stdout.trimEnd(),
				"",
				"[stderr]",
				snapshot.liveLog.stderr.trimEnd(),
				"",
			].join("\n");
			updateTextAreaValue(this.outputArea, combined);
		}
	}

	private async copyToClipboard(text: string): Promise<void> {
		if (!text.trim()) {
			new Notice("No output to copy.");
			return;
		}

		try {
			// Clipboard API availability varies across Obsidian/Electron contexts.
			// TODO plugin clipboard abstraction
			const clipboard = (
				navigator as unknown as { clipboard?: { writeText?: (v: string) => Promise<void> } }
			).clipboard;
			if (!clipboard?.writeText) {
				new Notice("Clipboard not available.");
				return;
			}

			await clipboard.writeText(text);
			new Notice("Copied output to clipboard.");
		} catch {
			new Notice("Copy failed.");
		}
	}
}

function statusLine(snapshot: AilssIndexerStatusSnapshot): string {
	if (snapshot.running) return "Status: Indexing…";
	if (snapshot.lastErrorMessage) return `Status: Error\n${snapshot.lastErrorMessage}`;
	if (snapshot.lastSuccessAt) return "Status: Ready";
	return "Status: Not indexed";
}

function updateTextAreaValue(textarea: HTMLTextAreaElement, nextValue: string): void {
	const thresholdPx = 24;
	const atBottom =
		textarea.scrollTop + textarea.clientHeight >= textarea.scrollHeight - thresholdPx;

	textarea.value = nextValue;

	if (atBottom) {
		textarea.scrollTop = textarea.scrollHeight;
	}
}
