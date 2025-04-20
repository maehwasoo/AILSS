import { Notice } from 'obsidian';
import { RefactoringComponentProps } from './types';
import { ContentDiffPreviewComponent } from './ContentDiffPreviewComponent';

/**
 * AI 처리 결과 미리보기 및 확인 컴포넌트
 */
export class AIResultPreviewComponent {
    private props: RefactoringComponentProps;
    private onBack: () => void;
    private onAccept: () => void;
    private onCancel: () => void;
    private result: any;
    
    constructor(
        props: RefactoringComponentProps, 
        onBack: () => void,
        onAccept: () => void,
        onCancel: () => void,
        result: any
    ) {
        this.props = props;
        this.onBack = onBack;
        this.onAccept = onAccept;
        this.onCancel = onCancel;
        this.result = result;
    }
    
    /**
     * AI 결과 미리보기 UI 렌더링
     */
    render(): void {
        const { stepContainer, selectedOption } = this.props;
        stepContainer.empty();
        
        // 제목 설정
        let title = '';
        switch (selectedOption) {
            case 'merge': title = '노트 통합 결과 미리보기'; break;
            case 'split': title = '노트 분할 결과 미리보기'; break;
            case 'adjust': title = '노트 조정 결과 미리보기'; break;
        }
        
        // 헤더
        stepContainer.createEl('h3', { 
            text: title,
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 미리보기 컨테이너
        const previewContainer = stepContainer.createDiv({
            cls: 'ai-result-preview',
            attr: { style: 'margin-bottom: 1.5rem;' }
        });
        
        // 모드별 미리보기 UI 구성
        if (selectedOption === 'merge') {
            this.buildMergePreview(previewContainer, this.result);
        } else if (selectedOption === 'split') {
            this.buildSplitPreview(previewContainer, this.result);
        } else if (selectedOption === 'adjust') {
            this.buildAdjustPreview(previewContainer, this.result);
        }
        
        // 버튼 컨테이너
        const buttonContainer = stepContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 적용 버튼
        const applyButton = buttonContainer.createEl('button', {
            text: '변경사항 적용',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 취소 버튼
        const cancelButton = buttonContainer.createEl('button', {
            text: '취소',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 이벤트 리스너
        backButton.addEventListener('click', () => this.onBack());
        applyButton.addEventListener('click', () => this.onAccept());
        cancelButton.addEventListener('click', () => this.onCancel());
    }
    
    /**
     * 노트 통합 결과 미리보기 UI 구성
     */
    private buildMergePreview(container: HTMLElement, result: any): void {
        // 정보 박스
        const infoBox = container.createDiv({
            attr: { style: 'background-color: var(--background-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;' }
        });
        
        infoBox.createEl('h4', {
            text: '통합 결과',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        infoBox.createEl('p', {
            text: `"${result.title}" 노트에 노트 내용이 통합되었습니다.`,
            attr: { style: 'margin: 0 0 0.5rem 0;' }
        });
        
        // 변경사항 미리보기
        ContentDiffPreviewComponent.render(
            container, 
            '원본 내용', 
            '통합 후 내용', 
            result.originalContent, 
            result.newContent
        );
    }
    
    /**
     * 노트 분할 결과 미리보기 UI 구성
     */
    private buildSplitPreview(container: HTMLElement, result: any): void {
        // 정보 박스
        const infoBox = container.createDiv({
            attr: { style: 'background-color: var(--background-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;' }
        });
        
        infoBox.createEl('h4', {
            text: '분할 결과',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        infoBox.createEl('p', {
            text: `"${result.originalFile.title}" 노트가 ${result.newNotes.length}개의 새 노트로 분할됩니다.`,
            attr: { style: 'margin: 0;' }
        });
        
        // 새로 생성될 노트 미리보기
        const newNotesContainer = container.createDiv();
        
        newNotesContainer.createEl('h4', {
            text: '새로 생성될 노트 목록',
            attr: { style: 'margin: 0 0 1rem 0; font-weight: 600;' }
        });
        
        // 새 노트 아코디언 목록
        const notesAccordion = newNotesContainer.createDiv({
            attr: { style: 'display: flex; flex-direction: column; gap: 0.5rem;' }
        });
        
        result.newNotes.forEach((newNote: any, index: number) => {
            const notePreview = notesAccordion.createDiv({
                attr: { style: 'border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;' }
            });
            
            // 접기/펼치기 헤더
            const noteHeader = notePreview.createDiv({
                attr: { 
                    style: 'background-color: var(--background-secondary); padding: 0.8rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center;'
                }
            });
            
            noteHeader.createEl('span', {
                text: `${index + 1}. ${newNote.title}`,
                attr: { style: 'font-weight: 600;' }
            });
            
            const toggleIcon = noteHeader.createSpan({
                text: '▼',
                attr: { style: 'font-size: 0.8em;' }
            });
            
            // 내용 컨테이너 (기본적으로 접혀있음)
            const noteContent = notePreview.createDiv({
                attr: { style: 'padding: 0.8rem; display: none; max-height: 300px; overflow-y: auto; background-color: var(--background-primary-alt);' }
            });
            
            // 내용 렌더링 (마크다운 파싱하지 않고 텍스트로 표시)
            noteContent.createEl('pre', {
                text: newNote.content,
                attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace);' }
            });
            
            // 클릭 이벤트
            noteHeader.addEventListener('click', () => {
                const currentDisplay = noteContent.style.display;
                noteContent.style.display = currentDisplay === 'none' ? 'block' : 'none';
                toggleIcon.textContent = currentDisplay === 'none' ? '▲' : '▼';
            });
        });
    }
    
    /**
     * 노트 조정 결과 미리보기 UI 구성
     */
    private buildAdjustPreview(container: HTMLElement, results: any[]): void {
        // 정보 박스
        const infoBox = container.createDiv({
            attr: { style: 'background-color: var(--background-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;' }
        });
        
        infoBox.createEl('h4', {
            text: '조정 결과',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        infoBox.createEl('p', {
            text: `${results.length}개의 노트 내용이 주제별로 재조정되었습니다.`,
            attr: { style: 'margin: 0 0 0.5rem 0;' }
        });
        
        // 각 노트별 변경사항 미리보기 (아코디언 형식)
        const notesAccordion = container.createDiv({
            attr: { style: 'display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;' }
        });
        
        results.forEach((noteResult, index) => {
            const notePreview = notesAccordion.createDiv({
                attr: { style: 'border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;' }
            });
            
            // 접기/펼치기 헤더
            const noteHeader = notePreview.createDiv({
                attr: { 
                    style: 'background-color: var(--background-secondary); padding: 0.8rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center;'
                }
            });
            
            noteHeader.createEl('span', {
                text: `${index + 1}. ${noteResult.title}`,
                attr: { style: 'font-weight: 600;' }
            });
            
            const toggleIcon = noteHeader.createSpan({
                text: '▼',
                attr: { style: 'font-size: 0.8em;' }
            });
            
            // 내용 컨테이너 (기본적으로 접혀있음)
            const noteContent = notePreview.createDiv({
                attr: { style: 'padding: 0.8rem; display: none; background-color: var(--background-primary-alt);' }
            });
            
            // 내용 비교
            ContentDiffPreviewComponent.render(
                noteContent, 
                '원본 내용', 
                '조정 후 내용', 
                noteResult.originalContent, 
                // newContent에서 frontmatter 제외
                noteResult.newContent.replace(/---\n[\s\S]*?\n---\n\n/, ''),
                true
            );
            
            // 클릭 이벤트
            noteHeader.addEventListener('click', () => {
                const currentDisplay = noteContent.style.display;
                noteContent.style.display = currentDisplay === 'none' ? 'block' : 'none';
                toggleIcon.textContent = currentDisplay === 'none' ? '▲' : '▼';
            });
        });
    }
}