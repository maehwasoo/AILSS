import { App, Modal } from 'obsidian';

interface ConfirmationModalOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'default' | 'danger';  // 모달 타입 추가: 기본 또는 위험
}

export class ConfirmationModal extends Modal {
    private resolve: (value: boolean) => void;
    private options: ConfirmationModalOptions;

    constructor(app: App, options: ConfirmationModalOptions, resolve: (value: boolean) => void) {
        super(app);
        this.options = {
            title: '확인',
            confirmText: 'Yes',
            cancelText: 'No',
            type: 'default',  // 기본 타입
            ...options
        };
        this.resolve = resolve;
    }

    onOpen() {
        const {contentEl, modalEl} = this;
        
        // 모달 전체에 배경색 적용 (danger 타입일 경우)
        if (this.options.type === 'danger') {
            modalEl.addClass('danger-modal');
            // 인라인 스타일로 배경색 적용
            modalEl.setAttribute('style', 'background-color: rgba(255, 200, 200, 1.0) !important;');
        }
        
        const container = contentEl.createDiv({
            cls: "confirmation-modal-container",
            attr: { style: "padding: 2rem;" }
        });

        if (this.options.title) {
            let titleStyle = "margin: 0 0 1.5rem 0; font-size: 1.3em; font-weight: 600;";
            if (this.options.type === 'danger') {
                titleStyle += " color: rgb(175, 40, 40);";
            }
            
            container.createEl("h3", {
                text: this.options.title,
                cls: "modal-title",
                attr: { style: titleStyle }
            });
        }

        const messageColor = this.options.type === 'danger' ? 'black' : 'white';
        const messageContainer = container.createDiv({
            cls: "modal-message-container",
            attr: { 
                style: `white-space: pre-wrap; line-height: 1.6; margin-bottom: 2rem; color: ${messageColor};` 
            }
        });

        messageContainer.createSpan({
            text: this.options.message
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
        cancelButton.addEventListener("click", () => {
            this.close();
            this.resolve(false);
        });

        // 삭제 버튼 스타일 수정
        let confirmButtonStyle = "padding: 0.6rem 1.2rem; border-radius: 4px;";
        if (this.options.type === 'danger' && this.options.confirmText === '삭제') {
            confirmButtonStyle += " background-color: rgb(200, 60, 60); color: white; font-weight: 600;";
        }
        
        const confirmButton = buttonContainer.createEl("button", {
            text: this.options.confirmText,
            cls: "mod-cta",
            attr: { style: confirmButtonStyle }
        });
        confirmButton.addEventListener("click", () => {
            this.close();
            this.resolve(true);
        });
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }
}

export function showConfirmationDialog(app: App, options: ConfirmationModalOptions): Promise<boolean> {
    return new Promise(resolve => {
        new ConfirmationModal(app, options, resolve).open();
    });
}
