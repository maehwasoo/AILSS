import { App, Modal, Setting } from 'obsidian';
import { estimateTokens } from '../../modules/ai/ai_utils/accuracyChecker';

/**
 * 토큰 경고창 모달
 */
export class TokenWarningModal extends Modal {
    private originalNote: string;
    private onContinue: () => void;
    private tokenCount: number;

    constructor(app: App, originalNote: string, onContinue: () => void) {
        super(app);
        this.originalNote = originalNote;
        this.onContinue = onContinue;
        this.tokenCount = estimateTokens(originalNote);
        
        // 모달 컨텐츠 중앙 정렬 및 패딩 설정
        this.contentEl.style.textAlign = 'center';
        this.contentEl.style.padding = '20px';
    }

    onOpen() {
        const { contentEl } = this;

        // 타이틀 추가
        const titleEl = contentEl.createEl('h2', { 
            text: `토큰 길이 확인 (${this.tokenCount} 토큰)`, 
            cls: 'token-warning-title' 
        });
        titleEl.style.marginBottom = '30px';
        titleEl.style.marginTop = '0px';

        // 토큰 수에 따른 메시지와 권장사항 설정
        let warningMessage: string;
        let recommendationMessage: string;
        let warningColor: string;

        if (this.tokenCount > 12000) {
            warningMessage = '노트 길이가 매우 깁니다. 처리하는데 시간이 오래 걸리거나 일부 내용이 생략될 수 있습니다.';
            recommendationMessage = '노트를 더 작은 부분으로 나누거나, 핵심 내용만 선택하여 진행하세요.';
            warningColor = 'var(--color-red)';
        } else if (this.tokenCount > 8000) {
            warningMessage = '노트 길이가 깁니다. 처리 시간이 다소 길어질 수 있습니다.';
            recommendationMessage = '가능하다면 더 짧은 내용으로 진행하는 것이 좋습니다.';
            warningColor = 'var(--color-orange)';
        } else {
            warningMessage = '노트 길이가 적절합니다.';
            recommendationMessage = '이대로 진행해도 좋습니다.';
            warningColor = 'var(--color-green)';
        }

        // 경고 메시지 표시
        const warningContainer = contentEl.createDiv({ cls: 'token-warning-container' });
        warningContainer.style.backgroundColor = 'var(--background-secondary)';
        warningContainer.style.padding = '15px';
        warningContainer.style.borderRadius = '5px';
        warningContainer.style.marginBottom = '30px';
        
        const warningEl = warningContainer.createDiv({ 
            text: warningMessage, 
            cls: 'token-warning-message' 
        });
        warningEl.style.color = warningColor;
        warningEl.style.fontWeight = 'bold';
        warningEl.style.marginBottom = '10px';

        const recommendationEl = warningContainer.createDiv({ 
            text: recommendationMessage, 
            cls: 'token-recommendation-message' 
        });

        // 버튼 컨테이너
        const buttonContainer = contentEl.createDiv({ cls: 'token-warning-buttons' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        // 취소 버튼
        const cancelButton = buttonContainer.createEl('button', { text: '취소' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // 계속 진행 버튼
        const continueButton = buttonContainer.createEl('button', { 
            text: '계속 진행', 
            cls: 'mod-cta' 
        });
        continueButton.addEventListener('click', () => {
            this.close();
            this.onContinue();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
} 