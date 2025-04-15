import { Notice } from 'obsidian';
import { RefactoringComponentProps, RefactoringOption } from './types';
import { ContentDiffPreviewComponent } from './contentDiffPreview';

/**
 * AI 처리 결과 미리보기 및 확인 컴포넌트
 */
export class AIResultPreviewComponent {
    private props: RefactoringComponentProps;
    private onCancel: () => void;
    private onAccept: () => void;
    private originalContents: string[] = [];
    private processedContents: string[] = [];
    private titles: string[] = [];
    
    constructor(
        props: RefactoringComponentProps, 
        onCancel: () => void, 
        onAccept: () => void,
        originalContents: string[],
        processedContents: string[],
        titles: string[]
    ) {
        this.props = props;
        this.onCancel = onCancel;
        this.onAccept = onAccept;
        this.originalContents = originalContents;
        this.processedContents = processedContents;
        this.titles = titles;
    }
    
    /**
     * AI 결과 미리보기 UI 렌더링
     */
    render(): void {
        const { stepContainer, selectedOption } = this.props;
        stepContainer.empty();
        
        // 헤더
        let operationTitle = '';
        switch (selectedOption) {
            case 'merge':
                operationTitle = '노트 통합 결과';
                break;
            case 'split':
                operationTitle = '노트 분할 결과';
                break;
            case 'adjust':
                operationTitle = '노트 조정 결과';
                break;
            default:
                operationTitle = 'AI 처리 결과';
        }
        
        stepContainer.createEl('h3', { 
            text: operationTitle,
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 안내 메시지
        const infoContainer = stepContainer.createDiv({
            attr: { style: 'margin-bottom: 1.5rem; text-align: center;' }
        });
        
        infoContainer.createEl('p', {
            text: 'AI가 노트 내용을 처리한 결과입니다. 변경 내용을 검토한 후 수락하거나 취소하세요.',
            attr: { style: 'margin: 0; color: var(--text-muted);' }
        });
        
        // 결과 미리보기 스크롤 영역
        const previewScrollContainer = stepContainer.createDiv({
            attr: { 
                style: 'margin-bottom: 1.5rem; max-height: 400px; overflow-y: auto; padding-right: 10px;'
            }
        });
        
        const previewContainer = previewScrollContainer.createDiv({
            attr: { style: 'display: flex; flex-direction: column; gap: 2rem;' }
        });
        
        // 원본 내용과 처리된 내용 비교 표시
        for (let i = 0; i < this.originalContents.length; i++) {
            const isLast = i === this.originalContents.length - 1;
            
            // 비교 미리보기 제목
            const titleContainer = previewContainer.createDiv({
                attr: { style: 'display: flex; justify-content: space-between; align-items: center;' }
            });
            
            titleContainer.createEl('h4', {
                text: this.titles[i],
                attr: { style: 'margin: 0; font-weight: 600;' }
            });
            
            // 내용 비교 컴포넌트
            ContentDiffPreviewComponent.render(
                previewContainer,
                '원본 내용',
                '변경된 내용',
                this.originalContents[i],
                this.processedContents[i],
                false // 가로 배치
            );
            
            // 마지막 아이템이 아니면 구분선 추가
            if (!isLast) {
                previewContainer.createEl('hr', {
                    attr: { style: 'border: none; border-top: 1px solid var(--background-modifier-border); margin: 0;' }
                });
            }
        }
        
        // 버튼 컨테이너
        const buttonContainer = stepContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem; margin-top: 2rem;' }
        });
        
        // 취소 버튼
        const cancelButton = buttonContainer.createEl('button', {
            text: '취소',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 수락 버튼
        const acceptButton = buttonContainer.createEl('button', {
            text: '변경 수락',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 이벤트 리스너
        cancelButton.addEventListener('click', () => {
            new Notice('노트 변경이 취소되었습니다.');
            this.onCancel();
        });
        
        acceptButton.addEventListener('click', () => {
            this.onAccept();
        });
    }
}
