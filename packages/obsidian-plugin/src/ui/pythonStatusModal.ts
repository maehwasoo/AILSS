import { ButtonComponent, Modal, Notice, Setting } from "obsidian";

import type AilssObsidianPlugin from "../main.js";
import type { AilssPythonApiServiceStatusSnapshot } from "../pythonApi/pythonApiServiceTypes.js";
import { formatAilssTimestampForUi } from "../utils/dateTime.js";

export class AilssPythonStatusModal extends Modal {
	private statusTextEl: HTMLElement | null = null;
	private metaTextEl: HTMLElement | null = null;
	private errorTextEl: HTMLElement | null = null;
	private copyErrorButton: ButtonComponent | null = null;
	private healthButton: ButtonComponent | null = null;
	private restartButton: ButtonComponent | null = null;
	private checkingHealth = false;
	private restarting = false;

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

		contentEl.createEl("h2", { text: "AILSS Python backend status" });

		this.statusTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.metaTextEl = contentEl.createDiv({ cls: "ailss-status" });
		this.errorTextEl = contentEl.createDiv({ cls: "ailss-modal-message" });

		new Setting(contentEl)
			.setName("Actions")
			.addButton((button) => {
				this.copyErrorButton = button;
				button.setButtonText("Copy error message");
				button.onClick(
					() =>
						void this.copyToClipboard(
							this.plugin.getPythonApiServiceStatusSnapshot().lastErrorMessage ?? "",
							{
								emptyNotice: "No error message to copy.",
								successNotice: "Copied error message to clipboard.",
							},
						),
				);
			})
			.addButton((button) => {
				this.healthButton = button;
				button.setButtonText("Check health");
				button.onClick(() => void this.checkHealth());
			})
			.addButton((button) => {
				this.restartButton = button;
				button.setButtonText("Restart backend");
				button.setCta();
				button.onClick(() => void this.restartBackend());
			});

		this.refresh();
	}

	onClose(): void {
		this.statusTextEl = null;
		this.metaTextEl = null;
		this.errorTextEl = null;
		this.copyErrorButton = null;
		this.healthButton = null;
		this.restartButton = null;
		this.contentEl.empty();
	}

	private refresh(): void {
		const snapshot = this.plugin.getPythonApiServiceStatusSnapshot();
		this.render(snapshot);
	}

	private render(snapshot: AilssPythonApiServiceStatusSnapshot): void {
		if (this.statusTextEl) {
			this.statusTextEl.setText(
				statusLine(snapshot, {
					checkingHealth: this.checkingHealth,
					restarting: this.restarting,
				}),
			);
		}

		if (this.metaTextEl) {
			const startedAt = formatAilssTimestampForUi(snapshot.startedAt);
			const lastStoppedAt = formatAilssTimestampForUi(snapshot.lastStoppedAt);
			const metaParts = [
				"Runtime: Primary local backend",
				`Service: ${snapshot.enabled ? "Enabled" : "Disabled"}`,
				`URL: ${snapshot.url}`,
				startedAt ? `Started: ${startedAt}` : "",
				lastStoppedAt ? `Last stopped: ${lastStoppedAt}` : "",
				snapshot.lastExitCode === null ? "" : `Last exit: ${snapshot.lastExitCode}`,
				!snapshot.enabled ? "Enable the backend in settings to start or restart it." : "",
			];
			this.metaTextEl.setText(metaParts.filter(Boolean).join("\n"));
		}

		if (this.errorTextEl) {
			const message = snapshot.lastErrorMessage?.trim() ?? "";
			if (message) {
				this.errorTextEl.style.display = "";
				this.errorTextEl.setText(message);
			} else {
				this.errorTextEl.style.display = "none";
				this.errorTextEl.setText("");
			}
		}

		if (this.copyErrorButton) {
			this.copyErrorButton.setDisabled(
				this.checkingHealth || this.restarting || !snapshot.lastErrorMessage?.trim(),
			);
		}

		if (this.healthButton) {
			this.healthButton.setDisabled(
				this.checkingHealth || this.restarting || !snapshot.enabled,
			);
		}

		if (this.restartButton) {
			this.restartButton.setDisabled(
				this.checkingHealth || this.restarting || !snapshot.enabled,
			);
		}
	}

	private async copyToClipboard(
		text: string,
		notices: { emptyNotice: string; successNotice: string },
	): Promise<void> {
		if (!text.trim()) {
			new Notice(notices.emptyNotice);
			return;
		}

		try {
			// Clipboard API availability
			const clipboard = (
				navigator as unknown as { clipboard?: { writeText?: (v: string) => Promise<void> } }
			).clipboard;
			if (!clipboard?.writeText) {
				new Notice("Clipboard not available.");
				return;
			}

			await clipboard.writeText(text);
			new Notice(notices.successNotice);
		} catch {
			new Notice("Copy failed.");
		}
	}

	private async checkHealth(): Promise<void> {
		if (this.checkingHealth || this.restarting) return;

		this.checkingHealth = true;
		this.refresh();
		try {
			await this.plugin.checkPythonApiHealth();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Health check failed: ${message}`);
		} finally {
			this.checkingHealth = false;
			this.refresh();
		}
	}

	private async restartBackend(): Promise<void> {
		if (this.checkingHealth || this.restarting) return;

		this.restarting = true;
		this.refresh();
		try {
			await this.plugin.restartPythonApiService();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Restart failed: ${message}`);
		} finally {
			this.restarting = false;
			this.refresh();
		}
	}
}

function statusLine(
	snapshot: AilssPythonApiServiceStatusSnapshot,
	options: { checkingHealth: boolean; restarting: boolean },
): string {
	if (options.restarting) return "Status: Restarting…";
	if (options.checkingHealth) return "Status: Checking health…";
	if (!snapshot.enabled) return "Status: Off";
	if (snapshot.running) return "Status: Running";
	if (snapshot.lastErrorMessage) return "Status: Error";
	if (snapshot.lastStoppedAt) {
		const lastStoppedAt = formatAilssTimestampForUi(snapshot.lastStoppedAt);
		return `Status: Stopped (last: ${lastStoppedAt ?? snapshot.lastStoppedAt})`;
	}
	return "Status: Stopped";
}
