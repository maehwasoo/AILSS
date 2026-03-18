import { App, Modal, Notice, Setting } from "obsidian";

import { normalizeVaultRelPath } from "../utils/vault.js";

export type PythonApiCommandInput = {
	query: string;
	pathPrefix: string | null;
};

type PythonApiPromptModalOptions = {
	title: string;
	description: string;
	submitText: string;
	queryPlaceholder: string;
	pathPrefixPlaceholder: string;
	onResolve: (value: PythonApiCommandInput | null) => void;
};

class PythonApiPromptModal extends Modal {
	private query = "";
	private pathPrefix = "";
	private resolved = false;

	constructor(
		app: App,
		private readonly options: PythonApiPromptModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createDiv({ text: this.options.description });

		const queryContainer = contentEl.createDiv();
		queryContainer.createEl("label", { text: "Query" });
		const queryInput = queryContainer.createEl("textarea");
		queryInput.rows = 6;
		queryInput.placeholder = this.options.queryPlaceholder;
		queryInput.value = this.query;
		queryInput.addEventListener("input", () => {
			this.query = queryInput.value;
		});

		const pathPrefixContainer = contentEl.createDiv();
		pathPrefixContainer.createEl("label", { text: "Path prefix (optional)" });
		const pathPrefixInput = pathPrefixContainer.createEl("input");
		pathPrefixInput.type = "text";
		pathPrefixInput.placeholder = this.options.pathPrefixPlaceholder;
		pathPrefixInput.value = this.pathPrefix;
		pathPrefixInput.addEventListener("input", () => {
			this.pathPrefix = pathPrefixInput.value;
		});

		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel");
				button.onClick(() => {
					this.resolve(null);
				});
			})
			.addButton((button) => {
				button.setButtonText(this.options.submitText);
				button.setCta();
				button.onClick(() => {
					this.submit();
				});
			});

		window.setTimeout(() => {
			queryInput.focus();
		}, 0);
	}

	onClose(): void {
		if (!this.resolved) {
			this.resolve(null);
		}
		this.contentEl.empty();
	}

	private submit(): void {
		const query = this.query.trim();
		if (!query) {
			new Notice("Enter a query first.");
			return;
		}

		this.resolve({
			query,
			pathPrefix: normalizePathPrefix(this.pathPrefix),
		});
	}

	private resolve(value: PythonApiCommandInput | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.close();
		this.options.onResolve(value);
	}
}

type TextViewModalOptions = {
	title: string;
	body: string;
};

class TextViewModal extends Modal {
	constructor(
		app: App,
		private readonly options: TextViewModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.options.title });
		const pre = contentEl.createEl("pre");
		pre.textContent = this.options.body;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export async function openPythonApiPromptModal(
	app: App,
	options: Omit<PythonApiPromptModalOptions, "onResolve">,
): Promise<PythonApiCommandInput | null> {
	return await new Promise((resolve) => {
		new PythonApiPromptModal(app, {
			...options,
			onResolve: resolve,
		}).open();
	});
}

export function openTextViewModal(app: App, options: TextViewModalOptions): void {
	new TextViewModal(app, options).open();
}

function normalizePathPrefix(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	return normalizeVaultRelPath(trimmed);
}
