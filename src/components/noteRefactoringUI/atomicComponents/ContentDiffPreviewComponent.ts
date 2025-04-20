/**
 * 내용 비교 미리보기 컴포넌트
 * 변경 사항을 시각적으로 강조하여 표시합니다.
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
        
        // 변경 사항 요약 정보
        const diffSummary = this.generateDiffSummary(originalContent, newContent);
        const summaryEl = diffContainer.createDiv({
            cls: 'diff-summary',
            attr: { 
                style: 'background-color: var(--background-secondary-alt); padding: 0.8rem; border-radius: 4px; margin-bottom: 0.5rem;'
            }
        });
        
        summaryEl.createEl('h5', {
            text: '변경 사항 요약',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const summaryContent = summaryEl.createDiv({
            attr: { style: 'display: flex; gap: 1rem; font-size: 0.9em;' }
        });
        
        // 추가된 줄 수 표시
        const addedLines = summaryContent.createDiv({
            attr: { style: 'display: flex; align-items: center; gap: 0.5rem;' }
        });
        
        addedLines.createDiv({
            attr: { 
                style: 'width: 12px; height: 12px; border-radius: 50%; background-color: rgba(var(--background-modifier-success-rgb), 0.6);' 
            }
        });
        
        addedLines.createSpan({ text: `${diffSummary.addedLines}개 추가됨` });
        
        // 삭제된 줄 수 표시
        const deletedLines = summaryContent.createDiv({
            attr: { style: 'display: flex; align-items: center; gap: 0.5rem;' }
        });
        
        deletedLines.createDiv({
            attr: { 
                style: 'width: 12px; height: 12px; border-radius: 50%; background-color: rgba(var(--background-modifier-error-rgb), 0.6);' 
            }
        });
        
        deletedLines.createSpan({ text: `${diffSummary.deletedLines}개 삭제됨` });
        
        // 변경된 줄 수 표시
        const changedLines = summaryContent.createDiv({
            attr: { style: 'display: flex; align-items: center; gap: 0.5rem;' }
        });
        
        changedLines.createDiv({
            attr: { 
                style: 'width: 12px; height: 12px; border-radius: 50%; background-color: rgba(var(--background-modifier-accent-rgb), 0.6);' 
            }
        });
        
        changedLines.createSpan({ text: `${diffSummary.changedLines}개 변경됨` });
        
        // 원본 내용과 새 내용 비교
        const contentContainer = diffContainer.createDiv({
            attr: { style: `display: flex; flex-direction: ${compact ? 'column' : 'row'}; gap: 1rem;` }
        });
        
        // 통합 뷰 모드 버튼 추가
        const viewModeContainer = diffContainer.createDiv({
            attr: { style: 'display: flex; justify-content: flex-end; margin-bottom: 0.8rem;' }
        });
        
        const unifiedViewBtn = viewModeContainer.createEl('button', {
            text: '통합 뷰',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.4rem 0.8rem; font-size: 0.8em; margin-right: 0.5rem;' }
        });
        
        const sideBySideBtn = viewModeContainer.createEl('button', {
            text: '병렬 뷰',
            attr: { style: 'padding: 0.4rem 0.8rem; font-size: 0.8em;' }
        });
        
        // 통합 뷰 컨테이너 (처음에는 숨겨져 있음)
        const unifiedViewContainer = diffContainer.createDiv({
            attr: { style: 'display: none;' }
        });
        
        // 양방향 비교 컨테이너 (기본 표시)
        const sideBySideContainer = diffContainer.createDiv({
            attr: { style: `display: flex; flex-direction: ${compact ? 'column' : 'row'}; gap: 1rem;` }
        });
        
        // 원본 내용
        const originalContainer = sideBySideContainer.createDiv({
            attr: { style: `flex: 1; ${compact ? '' : 'max-width: 50%;'}` }
        });
        
        originalContainer.createEl('h5', {
            text: originalTitle,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const originalContentBox = originalContainer.createDiv({
            cls: 'original-content',
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 0.8rem; border-radius: 4px; max-height: 300px; overflow-y: auto;'
            }
        });
        
        // frontmatter 제외
        const cleanOriginalContent = originalContent.replace(/---\n[\s\S]*?\n---\n\n/, '');
        
        // 원본 내용을 줄 단위로 표시하되 삭제된 부분 강조
        this.renderDiffContent(originalContentBox, cleanOriginalContent, cleanOriginalContent, newContent, 'original');
        
        // 새 내용
        const newContainer = sideBySideContainer.createDiv({
            attr: { style: `flex: 1; ${compact ? '' : 'max-width: 50%;'}` }
        });
        
        newContainer.createEl('h5', {
            text: newTitle,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const newContentBox = newContainer.createDiv({
            cls: 'new-content',
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 0.8rem; border-radius: 4px; max-height: 300px; overflow-y: auto;'
            }
        });
        
        // frontmatter 제외
        const cleanNewContent = newContent.replace(/---\n[\s\S]*?\n---\n\n/, '');
        
        // 새 내용을 줄 단위로 표시하되 추가된 부분 강조
        this.renderDiffContent(newContentBox, cleanNewContent, cleanOriginalContent, cleanNewContent, 'new');
        
        // 통합 뷰에 내용 추가
        this.renderUnifiedDiff(unifiedViewContainer, originalTitle, newTitle, cleanOriginalContent, cleanNewContent);
        
        // 뷰 모드 전환 이벤트
        unifiedViewBtn.addEventListener('click', () => {
            unifiedViewContainer.style.display = 'block';
            sideBySideContainer.style.display = 'none';
            unifiedViewBtn.className = 'mod-cta';
            sideBySideBtn.className = '';
        });
        
        sideBySideBtn.addEventListener('click', () => {
            unifiedViewContainer.style.display = 'none';
            sideBySideContainer.style.display = `flex`;
            sideBySideContainer.style.flexDirection = compact ? 'column' : 'row';
            unifiedViewBtn.className = '';
            sideBySideBtn.className = 'mod-cta';
        });
        
        // 이전/다음 변경 사항 탐색 버튼
        if (diffSummary.changedLines > 0 || diffSummary.addedLines > 0 || diffSummary.deletedLines > 0) {
            const navigationContainer = diffContainer.createDiv({
                attr: { style: 'display: flex; justify-content: center; gap: 1rem; margin-top: 1rem;' }
            });
            
            const prevChangeBtn = navigationContainer.createEl('button', {
                text: '이전 변경',
                attr: { style: 'padding: 0.4rem 0.8rem; border-radius: 4px;' }
            });
            
            const nextChangeBtn = navigationContainer.createEl('button', {
                text: '다음 변경',
                attr: { style: 'padding: 0.4rem 0.8rem; border-radius: 4px;' }
            });
            
            // 탐색 기능 구현 (클라이언트 측에서 스크롤 처리)
            prevChangeBtn.addEventListener('click', () => {
                this.navigateChanges('prev');
            });
            
            nextChangeBtn.addEventListener('click', () => {
                this.navigateChanges('next');
            });
        }
    }
    
    /**
     * 내용의 차이점을 분석하여 요약 정보를 생성합니다.
     */
    private static generateDiffSummary(originalContent: string, newContent: string): {
        addedLines: number,
        deletedLines: number,
        changedLines: number
    } {
        // 간단한 라인 기반 diff 분석
        const originalLines = originalContent.split('\n');
        const newLines = newContent.split('\n');
        
        let addedLines = 0;
        let deletedLines = 0;
        let changedLines = 0;
        
        // 매우 간단한 차이 분석 - 실제로는 더 정교한 알고리즘이 필요할 수 있음
        const maxLines = Math.max(originalLines.length, newLines.length);
        
        for (let i = 0; i < maxLines; i++) {
            const originalLine = i < originalLines.length ? originalLines[i] : null;
            const newLine = i < newLines.length ? newLines[i] : null;
            
            if (originalLine === null && newLine !== null) {
                addedLines++;
            } else if (originalLine !== null && newLine === null) {
                deletedLines++;
            } else if (originalLine !== newLine) {
                changedLines++;
            }
        }
        
        return { addedLines, deletedLines, changedLines };
    }
    
    /**
     * 내용의 변경 사항을 시각적으로 강조하여 표시합니다.
     */
    private static renderDiffContent(
        container: HTMLElement,
        content: string,
        originalContent: string,
        newContent: string,
        mode: 'original' | 'new'
    ): void {
        const originalLines = originalContent.split('\n');
        const newLines = newContent.split('\n');
        const contentLines = content.split('\n');
        
        const preElement = container.createEl('pre', {
            attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace); font-size: 0.9em;' }
        });
        
        contentLines.forEach((line, index) => {
            // 라인이 원본과 새 내용 중 하나에만 있는지 확인
            const isInOriginal = index < originalLines.length;
            const isInNew = index < newLines.length;
            const originalLine = isInOriginal ? originalLines[index] : null;
            const newLine = isInNew ? newLines[index] : null;
            
            const lineElement = preElement.createSpan({
                attr: { 
                    class: 'diff-line',
                    style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px;' 
                }
            });
            
            // 라인 번호 표시
            lineElement.createSpan({
                text: `${index + 1}`.padStart(3, ' ') + ' ',
                attr: { style: 'color: var(--text-muted); user-select: none; margin-right: 0.5rem;' }
            });
            
            // 변경 사항에 따라 배경색 설정
            if (mode === 'original' && originalLine !== newLine) {
                if (!isInNew) {
                    // 원본에서 삭제된 줄
                    lineElement.setAttribute('style', 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-error-rgb), 0.2); position: relative;');
                    lineElement.createSpan({ text: '- ' });
                } else {
                    // 변경된 줄
                    lineElement.setAttribute('style', 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-accent-rgb), 0.1); position: relative;');
                }
                
                // 변경된 부분 강조
                this.highlightChangesInLine(lineElement, originalLine, newLine || '', 'delete');
                
                // 변경 표시 마커
                lineElement.createSpan({
                    text: '●',
                    attr: { 
                        class: 'diff-marker', 
                        style: 'position: absolute; right: 0.5rem; font-size: 0.7em; color: var(--text-accent);'
                    }
                });
            } else if (mode === 'new' && originalLine !== newLine) {
                if (!isInOriginal) {
                    // 새로 추가된 줄
                    lineElement.setAttribute('style', 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-success-rgb), 0.2); position: relative;');
                    lineElement.createSpan({ text: '+ ' });
                } else {
                    // 변경된 줄
                    lineElement.setAttribute('style', 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-accent-rgb), 0.1); position: relative;');
                }
                
                // 변경된 부분 강조
                this.highlightChangesInLine(lineElement, originalLine || '', newLine, 'add');
                
                // 변경 표시 마커
                lineElement.createSpan({
                    text: '●',
                    attr: { 
                        class: 'diff-marker', 
                        style: 'position: absolute; right: 0.5rem; font-size: 0.7em; color: var(--text-accent);'
                    }
                });
            } else {
                // 변경되지 않은 줄
                lineElement.createSpan({ text: line });
            }
        });
    }
    
    /**
     * 라인 내의 변경 사항을 강조 표시합니다.
     */
    private static highlightChangesInLine(
        container: HTMLElement,
        originalLine: string | null,
        newLine: string | null,
        mode: 'add' | 'delete'
    ): void {
        if (originalLine === null || newLine === null) {
            container.createSpan({ text: originalLine || newLine || '' });
            return;
        }
        
        // 간단한 문자 단위 비교 (실제로는 더 정교한 diff 알고리즘을 사용해야 함)
        if (originalLine === newLine) {
            container.createSpan({ text: originalLine });
            return;
        }
        
        // 라인 전체를 변경된 것으로 표시 (더 정교한 구현을 위해서는 차이 분석 알고리즘 필요)
        container.createSpan({ 
            text: mode === 'add' ? newLine : originalLine,
            attr: { 
                style: mode === 'add' 
                    ? 'font-weight: 500; text-decoration: underline;'
                    : 'text-decoration: line-through; opacity: 0.8;'
            } 
        });
    }
    
    /**
     * 통합 뷰에서 원본 및 새 내용의 차이를 표시합니다.
     */
    private static renderUnifiedDiff(
        container: HTMLElement,
        originalTitle: string,
        newTitle: string,
        originalContent: string,
        newContent: string
    ): void {
        container.createEl('h5', {
            text: '통합 차이점 뷰',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        const unifiedBox = container.createDiv({
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 0.8rem; border-radius: 4px; max-height: 350px; overflow-y: auto;'
            }
        });
        
        const originalLines = originalContent.split('\n');
        const newLines = newContent.split('\n');
        
        const preElement = unifiedBox.createEl('pre', {
            attr: { style: 'white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-monospace); font-size: 0.9em;' }
        });
        
        // 두 내용의 모든 라인을 비교하여 통합 뷰로 표시
        const maxLines = Math.max(originalLines.length, newLines.length);
        
        for (let i = 0; i < maxLines; i++) {
            const originalLine = i < originalLines.length ? originalLines[i] : null;
            const newLine = i < newLines.length ? newLines[i] : null;
            
            if (originalLine === null) {
                // 추가된 라인
                const lineElement = preElement.createSpan({
                    attr: { 
                        class: 'diff-line added',
                        style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-success-rgb), 0.2); position: relative;' 
                    }
                });
                
                lineElement.createSpan({
                    text: '+',
                    attr: { style: 'color: var(--text-success); margin-right: 0.5rem; user-select: none;' }
                });
                
                lineElement.createSpan({ text: newLine || '' });
            } else if (newLine === null) {
                // 삭제된 라인
                const lineElement = preElement.createSpan({
                    attr: { 
                        class: 'diff-line deleted',
                        style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-error-rgb), 0.2); position: relative;' 
                    }
                });
                
                lineElement.createSpan({
                    text: '-',
                    attr: { style: 'color: var(--text-error); margin-right: 0.5rem; user-select: none;' }
                });
                
                lineElement.createSpan({ text: originalLine });
            } else if (originalLine !== newLine) {
                // 변경된 라인 - 삭제된 내용 먼저 표시
                const deletedElement = preElement.createSpan({
                    attr: { 
                        class: 'diff-line deleted',
                        style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-error-rgb), 0.2); position: relative;' 
                    }
                });
                
                deletedElement.createSpan({
                    text: '-',
                    attr: { style: 'color: var(--text-error); margin-right: 0.5rem; user-select: none;' }
                });
                
                deletedElement.createSpan({ text: originalLine });
                
                // 추가된 내용 표시
                const addedElement = preElement.createSpan({
                    attr: { 
                        class: 'diff-line added',
                        style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px; background-color: rgba(var(--background-modifier-success-rgb), 0.2); position: relative;' 
                    }
                });
                
                addedElement.createSpan({
                    text: '+',
                    attr: { style: 'color: var(--text-success); margin-right: 0.5rem; user-select: none;' }
                });
                
                addedElement.createSpan({ text: newLine });
            } else {
                // 변경 없는 라인
                const lineElement = preElement.createSpan({
                    attr: { 
                        class: 'diff-line unchanged',
                        style: 'display: block; padding: 0.1rem 0.3rem; border-radius: 2px;' 
                    }
                });
                
                lineElement.createSpan({
                    text: ' ',
                    attr: { style: 'margin-right: 0.5rem; user-select: none;' }
                });
                
                lineElement.createSpan({ text: originalLine });
            }
        }
    }
    
    /**
     * 변경 사항 사이를 탐색합니다.
     * 실제 구현은 클라이언트 측에서 스크롤 위치를 조정해야 합니다.
     */
    private static navigateChanges(direction: 'next' | 'prev'): void {
        // 클라이언트 측에서 변경 사항 탐색 구현
        // 이 메서드는 브라우저에서 DOM 요소에 접근하여 스크롤 위치를 조정해야 함
        // 여기서는 기본 구조만 제공함
        
        // 변경된 라인을 모두 선택
        const changedLines = document.querySelectorAll('.diff-line.added, .diff-line.deleted, .diff-line.changed');
        if (changedLines.length === 0) return;
        
        // 현재 보이는(viewport 내) 변경 라인 찾기
        // 여기서는 실제 구현을 간소화하고 권장 방식만 주석으로 제공
        
        // 다음/이전 변경 사항으로 스크롤
        // 실제 브라우저 환경에서 element.scrollIntoView() 메서드를 사용해야 함
    }
}