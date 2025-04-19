import { App, Modal } from 'obsidian';

interface InputModalOptions {
    title?: string;
    message: string;
    placeholder?: string;
    submitText?: string;
    cancelText?: string;
}

export class InputModal extends Modal {
    private resolve: (value: string) => void;
    private options: InputModalOptions;

    constructor(app: App, options: InputModalOptions, resolve: (value: string) => void) {
        super(app);
        this.options = {
            title: '입력',
            submitText: '확인',
            cancelText: '취소',
            ...options
        };
        this.resolve = resolve;
    }

    onOpen() {
        const {contentEl} = this;
        
        const container = contentEl.createDiv({
            cls: "input-modal-container",
            attr: { style: "padding: 2rem;" }
        });

        if (this.options.title) {
            container.createEl("h3", {
                text: this.options.title,
                cls: "modal-title",
                attr: { style: "margin: 0 0 1.5rem 0; font-size: 1.3em; font-weight: 600;" }
            });
        }

        container.createSpan({
            text: this.options.message,
            attr: { style: "display: block; margin-bottom: 1rem;" }
        });

        const input = container.createEl("input", {
            attr: {
                type: "text",
                placeholder: this.options.placeholder || "",
                style: "width: 100%; margin-bottom: 1.5rem;"
            }
        });

        const buttonContainer = container.createDiv({
            cls: "modal-button-container",
            attr: { style: "display: flex; justify-content: flex-end; gap: 0.8rem;" }
        });

        const cancelButton = buttonContainer.createEl("button", {
            text: this.options.cancelText,
            attr: { style: "padding: 0.6rem 1.2rem; border-radius: 4px;" }
        });
        cancelButton.addEventListener("click", () => {
            this.close();
            this.resolve("");
        });

        const submitButton = buttonContainer.createEl("button", {
            text: this.options.submitText,
            cls: "mod-cta",
            attr: { style: "padding: 0.6rem 1.2rem; border-radius: 4px;" }
        });
        submitButton.addEventListener("click", () => {
            this.close();
            this.resolve(input.value);
        });

        input.focus();
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
} 