import { App, Modal, Setting } from "obsidian";

export type ConfirmModalOptions = {
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => Promise<void> | void;
};

export class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly options: ConfirmModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ailss-obsidian");

		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createDiv({ cls: "ailss-modal-message", text: this.options.message });

		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText(this.options.cancelText ?? "Cancel");
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(this.options.confirmText ?? "Confirm");
				button.setWarning();
				button.onClick(() => void this.confirm());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async confirm(): Promise<void> {
		if (this.confirmed) return;
		this.confirmed = true;
		try {
			await this.options.onConfirm();
		} finally {
			this.close();
		}
	}
}
