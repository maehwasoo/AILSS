/**
 * 내용 비교 미리보기 컴포넌트
 */
export class ContentDiffPreviewComponent {
    /**
     * 내용 비교 UI를 렌더링합니다.
     * @param container 컨테이너 요소
     * @param originalTitle 원본 내용 제목
     * @param newTitle 새 내용 제목
     * @param originalContent 원본 내용
     * @param newContent 새 내용
     * @param compact 가로/세로 배치 모드 (기본값: false - 가로 배치)
     */
    static render(
        container: HTMLElement,
        originalTitle: string,
        newTitle: string,
        originalContent: string,
        newContent: string,
        compact: boolean = false
    ): void {
        const diffContainer = container.createDiv({
            attr: { style: 'display: flex; flex-direction: column; gap: 1rem;' }
        });
        
        // 원본 내용과 새 내용 비교
        const contentContainer = diffContainer.createDiv({
            attr: { style: `display: flex; flex-direction: ${compact ? 'column' : 'row'}; gap: 1rem;` }
        });
        
        // 원본 내용
        const originalContainer = contentContainer.createDiv({
            attr: { style: `flex: 1; ${compact ? '' : 'max-width: 50%;'}` }
        });
        
        originalContainer.createEl('h5', {
            text: originalTitle,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const originalContentBox = originalContainer.createDiv({
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 0.8rem; border-radius: 4px; max-height: 300px; overflow-y: auto;'
            }
        });
        
        // frontmatter 제외
        const cleanOriginalContent = originalContent.replace(/---\n[\s\S]*?\n---\n\n/, '');
        
        originalContentBox.createEl('pre', {
            text: cleanOriginalContent,
            attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace); font-size: 0.9em;' }
        });
        
        // 새 내용
        const newContainer = contentContainer.createDiv({
            attr: { style: `flex: 1; ${compact ? '' : 'max-width: 50%;'}` }
        });
        
        newContainer.createEl('h5', {
            text: newTitle,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const newContentBox = newContainer.createDiv({
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 0.8rem; border-radius: 4px; max-height: 300px; overflow-y: auto;'
            }
        });
        
        // frontmatter 제외
        const cleanNewContent = newContent.replace(/---\n[\s\S]*?\n---\n\n/, '');
        
        newContentBox.createEl('pre', {
            text: cleanNewContent,
            attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace); font-size: 0.9em;' }
        });
    }
}