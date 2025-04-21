import { Notice, TFile } from 'obsidian';
import { RefactoringComponentProps } from './types';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';

/**
 * 노트 검색 및 선택 컴포넌트
 */
export class NoteSearchComponent {
    private props: RefactoringComponentProps;
    private onBack: () => void;
    private onNext: (selectedNotes: TFile[]) => void;
    
    private selectedNotes: TFile[] = [];
    private debounceTimer: number | null = null;
    private searchInput: HTMLInputElement;
    private searchResults: HTMLElement;
    private selectedNotesList: HTMLElement;
    private nextButton: HTMLButtonElement;
    
    constructor(
        props: RefactoringComponentProps, 
        onBack: () => void, 
        onNext: (selectedNotes: TFile[]) => void,
        initialSelectedNotes: TFile[] = []
    ) {
        this.props = props;
        this.onBack = onBack;
        this.onNext = onNext;
        this.selectedNotes = [...initialSelectedNotes];
    }
    
    /**
     * 노트 검색 UI 렌더링
     */
    render(): void {
        const { stepContainer, selectedOption } = this.props;
        stepContainer.empty();
        
        const searchContainer = stepContainer.createDiv({ cls: 'note-search-container' });
        
        // 헤더
        searchContainer.createEl('h3', { 
            text: selectedOption === 'merge' ? '노트 통합' : '노트 조정',
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 검색 필드
        const searchInputContainer = searchContainer.createDiv({
            attr: { style: 'margin-bottom: 1.5rem;' }
        });
        
        const placeholder = selectedOption === 'merge' ? '통합할 노트를 검색하세요' : '조정할 노트를 검색하세요';
        
        this.searchInput = searchInputContainer.createEl('input', {
            attr: {
                type: 'text',
                placeholder: placeholder,
                style: 'width: 100%; padding: 0.8rem; border-radius: 4px;'
            }
        });
        
        // 검색 실행 버튼
        const searchButton = searchInputContainer.createEl('button', {
            text: '검색',
            cls: 'mod-cta',
            attr: { style: 'margin-top: 0.8rem; padding: 0.6rem 1.2rem; width: 100%; border-radius: 4px;' }
        });
        
        // 검색 결과 컨테이너
        this.searchResults = searchContainer.createDiv({
            cls: 'search-results',
            attr: { style: 'max-height: 250px; overflow-y: auto; margin-bottom: 1.5rem; border-radius: 4px;' }
        });
        
        // 선택된 노트들 표시 컨테이너
        const selectedNotesContainer = searchContainer.createDiv({
            cls: 'selected-notes',
            attr: { style: 'margin-bottom: 1.5rem; background-color: var(--background-secondary); padding: 1rem; border-radius: 8px;' }
        });
        
        selectedNotesContainer.createEl('h4', { 
            text: '선택된 노트',
            attr: { style: 'margin: 0 0 0.8rem 0; font-weight: 600;' }
        });
        
        this.selectedNotesList = selectedNotesContainer.createEl('ul', { 
            attr: { style: 'padding-left: 1.5rem; margin: 0;' }
        });
        
        // 버튼 컨테이너
        const buttonContainer = searchContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 다음 버튼
        this.nextButton = buttonContainer.createEl('button', {
            text: '다음',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        }) as HTMLButtonElement;
        this.nextButton.disabled = this.selectedNotes.length === 0;
        
        // 이벤트 리스너
        searchButton.addEventListener('click', () => this.performSearch());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });

        // 실시간 검색 (디바운스 적용)
        this.searchInput.addEventListener('input', () => {
            if (this.debounceTimer !== null) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = window.setTimeout(() => {
                this.performSearch();
            }, 300);
        });
        
        backButton.addEventListener('click', () => this.onBack());
        
        this.nextButton.addEventListener('click', () => {
            if (this.selectedNotes.length > 0) {
                this.onNext(this.selectedNotes);
            } else {
                new Notice('노트를 하나 이상 선택해주세요.');
            }
        });
        
        // 초기 상태 설정
        this.updateSelectedNotes();
    }
    
    /**
     * 검색 실행
     */
    private async performSearch(): Promise<void> {
        const query = this.searchInput.value.trim();
        // 빈 검색어이면 결과 초기화
        if (!query) {
            this.searchResults.empty();
            return;
        }
        
        this.searchResults.empty();
        
        // 검색 로직
        const { app, currentFile } = this.props;
        const files = app.vault.getMarkdownFiles();
        const results = files.filter(file => {
            // 현재 노트 제외
            if (file.path === currentFile.path) return false;
            
            // 제목 또는 경로에 검색어가 포함된 파일 필터링
            return file.basename.toLowerCase().includes(query.toLowerCase()) || 
                   file.path.toLowerCase().includes(query.toLowerCase());
        });
        
        if (results.length === 0) {
            this.searchResults.createEl('p', { 
                text: '검색 결과가 없습니다.',
                attr: { style: 'text-align: center; color: var(--text-muted); padding: 1rem;' }
            });
            return;
        }
        
        // 검색 결과 표시 - 카드 형식
        for (const file of results.slice(0, 10)) {
            const card = this.searchResults.createEl('div', { 
                cls: 'search-result-card',
                attr: { 
                    style: 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-secondary); transition: all 0.2s ease;' 
                }
            });
            
            card.addEventListener('mouseenter', () => {
                card.setAttribute('style', 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-modifier-hover); transition: all 0.2s ease;');
            });
            
            card.addEventListener('mouseleave', () => {
                card.setAttribute('style', 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-secondary); transition: all 0.2s ease;');
            });
            
            const titleContainer = card.createDiv({
                attr: { style: 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;' }
            });
            
            // frontmatter title 가져오기
            const content = await this.props.app.vault.cachedRead(file);
            const fm = new FrontmatterManager().parseFrontmatter(content);
            const fmTitle = fm?.title || file.basename;
            
            titleContainer.createEl('div', {
                text: fmTitle,
                attr: { style: 'flex: 1; text-align: left; font-weight: 600; word-break: break-all;' }
            });
            
            titleContainer.createEl('div', {
                text: file.basename,
                attr: { style: 'flex: 1; text-align: right; color: var(--text-muted);' }
            });
            
            const selectButton = card.createEl('button', {
                text: '선택',
                cls: 'mod-cta',
                attr: { style: 'padding: 0.5rem 1rem; border-radius: 4px; margin-top: 0.5rem; width: 100%;' }
            });
                   
            selectButton.addEventListener('click', () => {
                this.handleSearchResult(file);
            });
        }
        
        if (results.length > 10) {
            this.searchResults.createEl('p', { 
                text: `...외 ${results.length - 10}개 결과`,
                attr: { style: 'text-align: center; font-size: 0.9em; color: var(--text-muted); padding: 0.5rem;' }
            });
        }
    }
    
    /**
     * 검색 결과에서 노트 선택 처리
     */
    private handleSearchResult(file: TFile): void {
        const { currentFile } = this.props;
        
        // 중복 체크
        const isDuplicate = this.selectedNotes.some(f => f.path === file.path);
        // 현재 노트 체크
        const isCurrentNote = file.path === currentFile.path;
        
        if (!isDuplicate && !isCurrentNote) {
            this.selectedNotes.push(file);
            this.updateSelectedNotes();
        } else if (isDuplicate) {
            new Notice('이미 선택된 노트입니다.');
        } else if (isCurrentNote) {
            new Notice('현재 노트는 선택할 수 없습니다.');
        }
    }
    
    /**
     * 선택된 노트 목록 업데이트
     */
    private async updateSelectedNotes(): Promise<void> {
        this.selectedNotesList.empty();
        
        if (this.selectedNotes.length === 0) {
            this.selectedNotesList.createEl('li', { 
                text: '선택된 노트 없음',
                attr: { style: 'color: var(--text-muted);' }
            });
            this.nextButton.disabled = true;
            return;
        }
        
        for (const file of this.selectedNotes) {
            const item = this.selectedNotesList.createEl('li', {
                attr: { style: 'margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;' }
            });
            
            // frontmatter title 가져오기
            const content = await this.props.app.vault.cachedRead(file);
            const fm = new FrontmatterManager().parseFrontmatter(content);
            const fmTitle = fm?.title || file.basename;
            
            item.createSpan({ 
                text: fmTitle,
                attr: { style: 'font-weight: 500; flex: 1; text-align: left; word-break: break-all;' }
            });
            
            const removeButton = item.createEl('button', {
                text: '제거',
                attr: { style: 'font-size: 0.8em; padding: 0.3rem 0.5rem; border-radius: 4px;' }
            });
            
            removeButton.addEventListener('click', () => {
                this.selectedNotes = this.selectedNotes.filter(f => f.path !== file.path);
                this.updateSelectedNotes();
            });
        }
        this.nextButton.disabled = false;
    }
}
