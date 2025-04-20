import { RefactoringComponentProps } from './types';

/**
 * 노트 분할 확인 컴포넌트
 */
export class SplitConfirmationComponent {
    private props: RefactoringComponentProps;
    private onBack: () => void;
    private onExecute: () => void;
    
    constructor(
        props: RefactoringComponentProps, 
        onBack: () => void, 
        onExecute: () => void
    ) {
        this.props = props;
        this.onBack = onBack;
        this.onExecute = onExecute;
    }
    
    /**
     * 분할 확인 UI 렌더링
     */
    render(): void {
        const { stepContainer, fileTitle } = this.props;
        stepContainer.empty();
        
        const confirmContainer = stepContainer.createDiv({ cls: 'split-confirmation' });
        
        confirmContainer.createEl('h3', { 
            text: '노트 분할',
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        const splitInfoCard = confirmContainer.createDiv({
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;' 
            }
        });
        
        splitInfoCard.createEl('p', { 
            text: `"${fileTitle}" 노트의 내용을 분석하여 아래와 같이 처리합니다:`,
            attr: { style: 'margin-top: 0; margin-bottom: 1rem; font-weight: 500;' } 
        });
        
        const benefitsList = splitInfoCard.createEl('ul', { attr: { style: 'padding-left: 1.5rem; margin: 0;' } });
        
        benefitsList.createEl('li', { 
            text: '주제별로 내용을 분류하고 분석합니다',
            attr: { style: 'margin-bottom: 0.5rem;' } 
        });
        
        benefitsList.createEl('li', { 
            text: '분류된 내용을 기반으로 새 노트를 생성합니다',
            attr: { style: 'margin-bottom: 0.5rem;' } 
        });
        
        benefitsList.createEl('li', { 
            text: '생성된 노트들 간에 자동으로 링크를 설정합니다',
            attr: { style: 'margin-bottom: 0.5rem;' } 
        });
        
        benefitsList.createEl('li', { 
            text: '현재 노트에는 핵심 주제 관련 내용만 남깁니다',
        });
        
        // 주의사항 카드
        const warningBox = confirmContainer.createDiv({
            cls: 'warning-box',
            attr: { 
                style: 'background-color: rgba(var(--background-modifier-error-rgb), 0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;' 
            }
        });
        
        warningBox.createEl('p', { 
            text: '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
            attr: { style: 'margin: 0; font-weight: 500; text-align: center;' } 
        });
        
        // 버튼 컨테이너
        const buttonContainer = confirmContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 실행 버튼
        const executeButton = buttonContainer.createEl('button', {
            text: '분할 실행',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 이벤트 리스너
        backButton.addEventListener('click', () => this.onBack());
        executeButton.addEventListener('click', () => this.onExecute());
    }
}