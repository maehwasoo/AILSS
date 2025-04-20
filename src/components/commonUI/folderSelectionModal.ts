import { App, Modal } from 'obsidian';

interface FolderSelectionModalOptions {
    title?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    folders: string[];
}

export class FolderSelectionModal extends Modal {
    private resolve: (folder: string) => void;
    private options: FolderSelectionModalOptions;

    constructor(app: App, options: FolderSelectionModalOptions, resolve: (folder: string) => void) {
        super(app);
        this.options = {
            title: '폴더 선택',
            placeholder: '폴더를 선택하세요',
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

        const select = container.createEl("select", {
            attr: {
                style: "width: 100%; margin-bottom: 2rem; padding: 0.6rem; border-radius: 4px;"
            }
        });

        // 기본 선택 옵션
        select.createEl("option", {
            text: this.options.placeholder,
            value: ""
        });

        // 폴더 목록 추가
        this.options.folders.forEach(folder => {
            select.createEl("option", {
                text: folder,
                value: folder
            });
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
            this.resolve("");
        };

        const confirmButton = buttonContainer.createEl("button", {
            text: this.options.confirmText,
            cls: "mod-cta",
            attr: { 
                style: "padding: 0.6rem 1.2rem; border-radius: 4px;" 
            }
        });
        confirmButton.onclick = () => {
            const selectedFolder = select.value;
            this.close();
            this.resolve(selectedFolder);
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export function showFolderSelectionDialog(app: App, options: FolderSelectionModalOptions): Promise<string> {
    return new Promise(resolve => {
        new FolderSelectionModal(app, options, resolve).open();
    });
} 