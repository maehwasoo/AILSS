import { App, Modal } from 'obsidian';

interface TagSelectionModalOptions {
    title?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
}

export class TagSelectionModal extends Modal {
    private resolve: (tags: string[]) => void;
    private options: TagSelectionModalOptions;

    constructor(app: App, options: TagSelectionModalOptions, resolve: (tags: string[]) => void) {
        super(app);
        this.options = {
            title: '태그 선택',
            placeholder: '태그를 입력하세요 (쉼표로 구분)',
            confirmText: '확인',
            cancelText: '취소',
            ...options
        };
        this.resolve = resolve;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "confirmation-modal-container",
            attr: { style: "padding: 2rem;" }
        });

        container.createEl("h3", {
            text: this.options.title,
            cls: "modal-title",
            attr: { 
                style: "margin: 0 0 1.5rem 0; font-size: 1.3em; font-weight: 600;" 
            }
        });

        const input = container.createEl("input", {
            type: "text",
            attr: {
                placeholder: this.options.placeholder ?? '태그를 입력하세요',
                style: "width: 100%; margin-bottom: 2rem; padding: 0.6rem; border-radius: 4px;"
            }
        });

        const buttonContainer = container.createDiv({
            cls: "modal-button-container",
            attr: { 
                style: "display: flex; justify-content: flex-end; gap: 0.8rem;" 
            }
        });

        const cancelButton = buttonContainer.createEl("button", {
            text: this.options.cancelText,
            attr: { 
                style: "padding: 0.6rem 1.2rem; border-radius: 4px;" 
            }
        });
        cancelButton.onclick = () => {
            this.close();
            this.resolve([]);
        };

        const confirmButton = buttonContainer.createEl("button", {
            text: this.options.confirmText,
            cls: "mod-cta",
            attr: { 
                style: "padding: 0.6rem 1.2rem; border-radius: 4px;" 
            }
        });
        confirmButton.onclick = () => {
            const tags = input.value.split(',').map(t => t.trim()).filter(t => t);
            this.close();
            this.resolve(tags);
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export function showTagSelectionDialog(app: App, options: TagSelectionModalOptions = {}): Promise<string[]> {
    return new Promise(resolve => {
        new TagSelectionModal(app, options, resolve).open();
    });
} 