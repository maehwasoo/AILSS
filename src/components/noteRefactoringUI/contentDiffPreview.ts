/**
 * 내용 비교 미리보기 컴포넌트
 * 원본 내용과 변경된 내용을 나란히 비교하여 보여줍니다.
 */
export class ContentDiffPreviewComponent {
    /**
     * 내용 비교 미리보기 UI 생성
     * @param container 컨테이너 엘리먼트
     * @param originalTitle 원본 제목
     * @param newTitle 새 제목
     * @param originalContent 원본 내용
     * @param newContent 새 내용
     * @param compact 작은 화면에 맞춰 세로로 배치할지 여부
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
        
        // frontmatter 제외 (이미 파라미터로 받은 newContent에서 처리했을 수도 있음)
        const cleanNewContent = newContent.replace(/---\n[\s\S]*?\n---\n\n/, '');
        
        newContentBox.createEl('pre', {
            text: cleanNewContent,
            attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace); font-size: 0.9em;' }
        });
    }
}
