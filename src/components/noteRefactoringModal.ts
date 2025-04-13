import { App, Modal, TFile, Notice, setIcon } from 'obsidian';
import AILSSPlugin from '../../main';
import { FrontmatterManager } from '../modules/maintenance/utils/frontmatterManager';
import { AINoteRefactor } from '../modules/ai/text/aiNoteRefactor';

interface NoteRefactoringModalOptions {
    file: TFile;
    id: string;
    title: string;
}

export class NoteRefactoringModal extends Modal {
    /**
     * 현재 활성화된 노트에 대해 리팩토링 모달을 엽니다.
     * @param app Obsidian 앱 인스턴스
     * @param plugin AILSS 플러그인 인스턴스
     */
    static openForActiveNote(app: App, plugin: AILSSPlugin): void {
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 노트가 없습니다.');
            return;
        }

        // 현재 파일의 frontmatter 읽기
        app.vault.read(activeFile).then((content) => {
            const frontmatterManager = new FrontmatterManager();
            const frontmatter = frontmatterManager.parseFrontmatter(content);
            
            if (!frontmatter) {
                new Notice('노트의 프론트매터를 찾을 수 없습니다.');
                return;
            }

            const title = frontmatter.title || activeFile.basename;
            const id = frontmatter.id || '';

            // 모달 열기
            new NoteRefactoringModal(app, plugin, {
                file: activeFile,
                id: id,
                title: title
            }).open();
        });
    }

    private options: NoteRefactoringModalOptions;
    private plugin: AILSSPlugin;
    private currentStep: 'selection' | 'search' | 'preview' | 'aiResult' = 'selection';
    private selectedOption: 'merge' | 'split' | 'adjust' | null = null;
    private selectedNotes: TFile[] = [];
    private searchInput: HTMLInputElement;
    private searchResults: HTMLElement;
    private previewContainer: HTMLElement;
    private stepContainer: HTMLElement;

    constructor(app: App, plugin: AILSSPlugin, options: NoteRefactoringModalOptions) {
        super(app);
        this.plugin = plugin;
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "note-refactoring-container",
            attr: { style: "padding: 2rem;" }
        });
        
        // 헤더 영역 - 중앙 정렬
        const headerContainer = container.createDiv({
            cls: "header-container",
            attr: { style: "display: flex; flex-direction: column; align-items: center; margin-bottom: 1.5rem;" }
        });
        
        // 타이틀 (상단)
        headerContainer.createEl('h2', { 
            text: this.options.title,
            attr: { style: "margin: 0 0 0.5rem 0; font-size: 1.5em; text-align: center;" }
        });
        
        // ID (하단에 작게)
        if (this.options.id) {
            headerContainer.createEl('div', { 
                text: `${this.options.id}`,
                attr: { style: "font-size: 0.9em; color: var(--text-muted); text-align: center;" }
            });
        }
        
        // 구분선
        container.createEl('hr', { attr: { style: "margin-bottom: 1.5rem;" } });
        
        // 스텝 컨테이너 생성
        this.stepContainer = container.createDiv({ 
            cls: 'note-refactoring-steps',
            attr: { style: "width: 100%;" }
        });
        
        // 첫 단계 표시: 옵션 선택
        this.showOptionSelection();
    }

    private showOptionSelection() {
        this.currentStep = 'selection';
        this.stepContainer.empty();
        
        // 제목
        this.stepContainer.createEl('h3', { 
            text: '리팩토링 옵션',
            attr: { style: "margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;" }
        });
        
        // 옵션 버튼 컨테이너 - 가로 배치
        const optionsContainer = this.stepContainer.createDiv({
            cls: 'note-refactoring-options',
            attr: {
                style: 'display: flex; gap: 1rem; margin-bottom: 2rem; width: 100%;'
            }
        });
        
        // 통합 버튼
        this.createOptionButton(optionsContainer, 'merge', '통합', 'merge');
        
        // 분할 버튼
        this.createOptionButton(optionsContainer, 'split', '분할', 'scissors');
        
        // 조정 버튼
        this.createOptionButton(optionsContainer, 'adjust', '조정', 'settings');
        
        // 옵션 설명 텍스트 컨테이너
        const descriptionContainer = this.stepContainer.createDiv({ 
            cls: 'options-descriptions',
            attr: { style: 'display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;' }
        });
        
        // 통합 설명
        this.createOptionDescription(
            descriptionContainer,
            '통합',
            '현재 노트에 다른 노트의 내용을 통합하여 주제별로 체계적으로 재구성합니다. 중복된 내용은 제거되고, 관련 내용은 함께 그룹화됩니다.'
        );
        
        // 분할 설명
        this.createOptionDescription(
            descriptionContainer,
            '분할',
            '현재 노트의 내용을 주제별로 분석하고 여러 개의 관련된 노트들로 분리합니다. 분할된 노트들은 상호 참조를 위해 자동으로 링크됩니다.'
        );
        
        // 조정 설명
        this.createOptionDescription(
            descriptionContainer,
            '조정',
            '현재 노트와 선택된 노트들 간의 내용을 주제별로 재분배합니다. 각 노트는 자신의 제목과 가장 관련 있는 내용만 유지하게 됩니다.'
        );
    }
    
    private createOptionDescription(container: HTMLElement, title: string, description: string) {
        const descItem = container.createDiv({
            attr: { style: 'background-color: var(--background-secondary); padding: 1rem; border-radius: 8px;' }
        });
        
        // 제목
        descItem.createEl('h5', {
            text: title,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600; font-size: 1em;' }
        });
        
        // 설명
        descItem.createEl('p', {
            text: description,
            attr: { style: 'margin: 0; color: var(--text-muted);' }
        });
    }
    
    private createOptionButton(container: HTMLElement, option: 'merge' | 'split' | 'adjust', text: string, iconName: string) {
        const button = container.createEl('button', {
            cls: 'mod-cta',
            attr: {
                style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; flex: 1; height: 90px; transition: all 0.3s ease;'
            }
        });
        
        // 아이콘
        const iconContainer = button.createDiv({
            attr: { style: 'font-size: 1.8em; margin-bottom: 0.5rem;' }
        });
        setIcon(iconContainer, iconName);
        
        // 텍스트 추가
        button.createSpan({ 
            text: text,
            attr: { style: 'font-weight: 600;' }
        });
        
        // 호버 효과
        button.addEventListener('mouseenter', () => {
            button.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; flex: 1; height: 90px; transition: all 0.3s ease; transform: translateY(-3px); box-shadow: 0 4px 8px rgba(0,0,0,0.1);');
        });
        
        button.addEventListener('mouseleave', () => {
            button.setAttribute('style', 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; flex: 1; height: 90px; transition: all 0.3s ease;');
        });
        
        button.addEventListener('click', () => {
            this.selectedOption = option;
            this.handleOptionSelected(option);
        });
    }
    
    private handleOptionSelected(option: 'merge' | 'split' | 'adjust') {
        switch (option) {
            case 'merge':
                this.showNoteSearch('통합할 노트를 검색하세요', true);
                break;
            case 'split':
                this.showSplitConfirmation();
                break;
            case 'adjust':
                this.showNoteSearch('조정할 노트를 검색하세요', true);
                break;
        }
    }
    
    private showNoteSearch(placeholder: string, allowMultiple: boolean = false) {
        this.currentStep = 'search';
        this.stepContainer.empty();
        this.selectedNotes = [];
        
        const searchContainer = this.stepContainer.createDiv({ cls: 'note-search-container' });
        
        // 헤더
        searchContainer.createEl('h3', { 
            text: this.selectedOption === 'merge' ? '노트 통합' : '노트 조정',
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 검색 필드
        const searchInputContainer = searchContainer.createDiv({
            attr: { style: 'margin-bottom: 1.5rem;' }
        });
        
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
        
        // 검색 결과 컨테이너 - 카드 형식
        this.searchResults = searchContainer.createDiv({
            cls: 'search-results',
            attr: { style: 'max-height: 200px; overflow-y: auto; margin-bottom: 1.5rem; border-radius: 4px;' }
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
        
        const selectedNotesList = selectedNotesContainer.createEl('ul', { 
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
        const nextButton = buttonContainer.createEl('button', {
            text: '다음',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        nextButton.disabled = true;
        
        // 이벤트 리스너
        searchButton.addEventListener('click', () => this.performSearch());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });
        
        backButton.addEventListener('click', () => this.showOptionSelection());
        
        nextButton.addEventListener('click', () => {
            if (this.selectedNotes.length > 0) {
                this.showPreview();
            } else {
                new Notice('노트를 하나 이상 선택해주세요.');
            }
        });
        
        // 선택된 노트 업데이트 함수
        const updateSelectedNotes = () => {
            selectedNotesList.empty();
            if (this.selectedNotes.length === 0) {
                selectedNotesList.createEl('li', { 
                    text: '선택된 노트 없음',
                    attr: { style: 'color: var(--text-muted);' }
                });
                nextButton.disabled = true;
            } else {
                this.selectedNotes.forEach(file => {
                    const item = selectedNotesList.createEl('li', {
                        attr: { style: 'margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;' }
                    });
                    
                    item.createSpan({ 
                        text: file.basename,
                        attr: { style: 'font-weight: 500;' }
                    });
                    
                    const removeButton = item.createEl('button', {
                        text: '제거',
                        attr: { style: 'font-size: 0.8em; padding: 0.3rem 0.5rem; border-radius: 4px;' }
                    });
                    
                    removeButton.addEventListener('click', () => {
                        this.selectedNotes = this.selectedNotes.filter(f => f.path !== file.path);
                        updateSelectedNotes();
                    });
                });
                nextButton.disabled = false;
            }
        };
        
        // 초기 상태 설정
        updateSelectedNotes();
        
        // 검색 결과 처리 함수 설정
        this.handleSearchResult = (file) => {
            // 중복 체크
            const isDuplicate = this.selectedNotes.some(f => f.path === file.path);
            // 현재 노트 체크
            const isCurrentNote = file.path === this.options.file.path;
            
            if (!isDuplicate && !isCurrentNote) {
                if (allowMultiple) {
                    this.selectedNotes.push(file);
                } else {
                    this.selectedNotes = [file];
                }
                updateSelectedNotes();
            } else if (isDuplicate) {
                new Notice('이미 선택된 노트입니다.');
            } else if (isCurrentNote) {
                new Notice('현재 노트는 선택할 수 없습니다.');
            }
        };
    }
    
    private handleSearchResult: (file: TFile) => void = () => {};
    
    private performSearch() {
        const query = this.searchInput.value.trim();
        if (!query) {
            new Notice('검색어를 입력해주세요.');
            return;
        }
        
        this.searchResults.empty();
        
        // 검색 로직
        const files = this.app.vault.getMarkdownFiles();
        const results = files.filter(file => {
            // 현재 노트 제외
            if (file.path === this.options.file.path) return false;
            
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
        results.slice(0, 10).forEach(file => {
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
            
            titleContainer.createEl('div', {
                text: file.basename,
                attr: { style: 'font-weight: 600; word-break: break-all;' }
            });
            
            const selectButton = card.createEl('button', {
                text: '선택',
                cls: 'mod-cta',
                attr: { style: 'padding: 0.5rem 1rem; border-radius: 4px; margin-top: 0.5rem; width: 100%;' }
            });
            
            // 파일 경로 표시
            card.createEl('div', {
                text: file.path,
                attr: { style: 'font-size: 0.8em; color: var(--text-muted); word-break: break-all;' }
            });
            
            selectButton.addEventListener('click', () => {
                this.handleSearchResult(file);
            });
        });
        
        if (results.length > 10) {
            this.searchResults.createEl('p', { 
                text: `...외 ${results.length - 10}개 결과`,
                attr: { style: 'text-align: center; font-size: 0.9em; color: var(--text-muted); padding: 0.5rem;' }
            });
        }
    }
    
    private showSplitConfirmation() {
        this.currentStep = 'preview';
        this.stepContainer.empty();
        
        const confirmContainer = this.stepContainer.createDiv({ cls: 'split-confirmation' });
        
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
            text: `"${this.options.title}" 노트의 내용을 분석하여 아래와 같이 처리합니다:`,
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
        
        backButton.addEventListener('click', () => this.showOptionSelection());
        
        executeButton.addEventListener('click', () => {
            this.executeSplit();
        });
    }
    
    private showPreview() {
        this.currentStep = 'preview';
        this.stepContainer.empty();
        
        this.previewContainer = this.stepContainer.createDiv({ cls: 'note-preview' });
        
        // 헤더
        const operationTitle = this.selectedOption === 'merge' ? '노트 통합' : '노트 조정';
        this.previewContainer.createEl('h3', { 
            text: operationTitle,
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 작업 정보 카드
        const operationInfoCard = this.previewContainer.createDiv({
            attr: { 
                style: 'background-color: var(--background-secondary); padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;' 
            }
        });
        
        operationInfoCard.createEl('h4', { 
            text: '처리할 노트',
            attr: { style: 'margin-top: 0; margin-bottom: 1rem; font-weight: 500;' } 
        });
        
        const notesList = operationInfoCard.createEl('ul', { attr: { style: 'padding-left: 1.5rem; margin: 0 0 1.5rem 0;' } });
        
        // 현재 노트 추가
        const currentNoteItem = notesList.createEl('li');
        
        currentNoteItem.createSpan({ 
            text: this.options.title,
            attr: { style: 'font-weight: 600;' } 
        });
        
        currentNoteItem.createSpan({ 
            text: ' (현재 노트)',
            attr: { style: 'color: var(--text-muted);' } 
        });
        
        // 선택된 다른 노트들
        this.selectedNotes.forEach(file => {
            notesList.createEl('li', { text: file.basename });
        });
        
        // 작업 설명
        if (this.selectedOption === 'merge') {
            operationInfoCard.createEl('h4', { 
                text: '통합 방식',
                attr: { style: 'margin: 0 0 0.8rem 0; font-weight: 500;' } 
            });
            
            const mergeList = operationInfoCard.createEl('ul', { attr: { style: 'padding-left: 1.5rem; margin: 0;' } });
            
            mergeList.createEl('li', { 
                text: '모든 노트의 내용이 현재 노트에 통합됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            mergeList.createEl('li', { 
                text: '중복된 내용은 자동으로 정리됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            mergeList.createEl('li', { 
                text: '주제별로 내용이 체계적으로 재구성됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            mergeList.createEl('li', { 
                text: '원본 노트들은 변경되지 않고 그대로 유지됩니다',
            });
        } else { // adjust
            operationInfoCard.createEl('h4', { 
                text: '조정 방식',
                attr: { style: 'margin: 0 0 0.8rem 0; font-weight: 500;' } 
            });
            
            const adjustList = operationInfoCard.createEl('ul', { attr: { style: 'padding-left: 1.5rem; margin: 0;' } });
            
            adjustList.createEl('li', { 
                text: '각 노트의 제목과 관련된 내용만 해당 노트에 유지됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            adjustList.createEl('li', { 
                text: '관련 없는 내용은 적절한 다른 노트로 이동됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            adjustList.createEl('li', { 
                text: '모든 노트의 내용이 재분배되어 구조가 개선됩니다',
                attr: { style: 'margin-bottom: 0.5rem;' } 
            });
            
            adjustList.createEl('li', { 
                text: '조정된 노트들은 서로 연결되어 관계가 유지됩니다',
            });
        }
        
        // 주의사항
        const warningBox = this.previewContainer.createDiv({
            cls: 'warning-box',
            attr: { 
                style: 'background-color: rgba(var(--background-modifier-error-rgb), 0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;' 
            }
        });
        
        warningBox.createEl('p', { 
            text: '이 작업은 선택한 노트들의 내용을 변경합니다. 계속하시겠습니까?',
            attr: { style: 'margin: 0; font-weight: 500; text-align: center;' } 
        });
        
        // 버튼 컨테이너
        const buttonContainer = this.previewContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 실행 버튼
        const executeButton = buttonContainer.createEl('button', {
            text: this.selectedOption === 'merge' ? '통합 실행' : '조정 실행',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        backButton.addEventListener('click', () => {
            this.showNoteSearch(
                this.selectedOption === 'merge' ? '통합할 노트를 검색하세요' : '조정할 노트를 검색하세요', 
                true
            );
        });
        
        executeButton.addEventListener('click', () => {
            if (this.selectedOption === 'merge') {
                this.executeMerge();
            } else if (this.selectedOption === 'adjust') {
                this.executeAdjust();
            }
        });
    }
    
    private async executeMerge() {
        try {
            // AI 통합 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 통합 처리 중...', 0); // 0 duration for persistent notice
            
            // AINoteRefactor 클래스 사용 (applyChanges=false로 설정하여 변경사항 적용하지 않고 미리보기만 생성)
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const mergeResult = await aiRefactor.mergeNotes(this.options.file, this.selectedNotes, false);
            
            loadingNotice.hide();
            
            // 결과 미리보기 모달 표시
            this.showAiResultPreview('merge', mergeResult);
        } catch (error: any) {
            new Notice(`노트 통합 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 통합 준비 오류:', error);
        }
    }
    
    private async executeSplit() {
        try {
            // AI 분할 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 분할 처리 중...', 0); // 0 duration for persistent notice
            
            // AINoteRefactor 클래스 사용 (applyChanges=false로 설정하여 변경사항 적용하지 않고 미리보기만 생성)
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const splitResult = await aiRefactor.splitNote(this.options.file, false);
            
            loadingNotice.hide();
            
            // 결과 미리보기 모달 표시
            this.showAiResultPreview('split', splitResult);
        } catch (error: any) {
            new Notice(`노트 분할 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 분할 준비 오류:', error);
        }
    }
    
    private async executeAdjust() {
        try {
            // AI 조정 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 조정 처리 중...', 0); // 0 duration for persistent notice
            
            // AINoteRefactor 클래스 사용 (applyChanges=false로 설정하여 변경사항 적용하지 않고 미리보기만 생성)
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const adjustResult = await aiRefactor.adjustNotes(this.options.file, this.selectedNotes, false);
            
            loadingNotice.hide();
            
            // 결과 미리보기 모달 표시
            this.showAiResultPreview('adjust', adjustResult);
        } catch (error: any) {
            new Notice(`노트 조정 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 조정 준비 오류:', error);
        }
    }

    /**
     * AI 처리 결과 미리보기 UI를 표시합니다.
     * @param mode 리팩토링 모드 (merge, split, adjust)
     * @param result AI 처리 결과 데이터
     */
    private showAiResultPreview(
        mode: 'merge' | 'split' | 'adjust', 
        result: any
    ) {
        this.currentStep = 'aiResult';
        this.stepContainer.empty();
        
        // 제목 설정
        let title = '';
        switch (mode) {
            case 'merge': title = '노트 통합 결과 미리보기'; break;
            case 'split': title = '노트 분할 결과 미리보기'; break;
            case 'adjust': title = '노트 조정 결과 미리보기'; break;
        }
        
        // 헤더
        this.stepContainer.createEl('h3', { 
            text: title,
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 미리보기 컨테이너
        const previewContainer = this.stepContainer.createDiv({
            cls: 'ai-result-preview',
            attr: { style: 'margin-bottom: 1.5rem;' }
        });
        
        // 모드별 미리보기 UI 구성
        if (mode === 'merge') {
            this.buildMergePreview(previewContainer, result);
        } else if (mode === 'split') {
            this.buildSplitPreview(previewContainer, result);
        } else if (mode === 'adjust') {
            this.buildAdjustPreview(previewContainer, result);
        }
        
        // 버튼 컨테이너
        const buttonContainer = this.stepContainer.createDiv({
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
        backButton.addEventListener('click', () => {
            if (mode === 'merge' || mode === 'adjust') {
                this.showNoteSearch(
                    mode === 'merge' ? '통합할 노트를 검색하세요' : '조정할 노트를 검색하세요', 
                    true
                );
            } else if (mode === 'split') {
                this.showSplitConfirmation();
            }
        });
        
        applyButton.addEventListener('click', async () => {
            const loadingNotice = new Notice('변경사항 적용 중...', 0);
            
            try {
                const aiRefactor = new AINoteRefactor(this.app, this.plugin);
                
                if (mode === 'merge') {
                    await aiRefactor.mergeNotes(this.options.file, this.selectedNotes, true);
                    new Notice('노트 통합이 완료되었습니다.');
                } else if (mode === 'split') {
                    await aiRefactor.splitNote(this.options.file, true);
                    new Notice(`노트 분할이 완료되었습니다. ${result.newNotes.length}개의 새 노트가 생성되었습니다.`);
                } else if (mode === 'adjust') {
                    await aiRefactor.adjustNotes(this.options.file, this.selectedNotes, true);
                    new Notice(`노트 조정이 완료되었습니다. ${result.length}개의 노트가 업데이트되었습니다.`);
                }
                
                this.close();
            } catch (error: any) {
                new Notice(`변경사항 적용 중 오류가 발생했습니다: ${error.message}`);
                console.error('변경사항 적용 오류:', error);
            } finally {
                loadingNotice.hide();
            }
        });
        
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }
    
    /**
     * 노트 통합 결과 미리보기 UI 구성
     */
    private buildMergePreview(container: HTMLElement, result: any) {
        // 정보 박스
        const infoBox = container.createDiv({
            attr: { style: 'background-color: var(--background-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;' }
        });
        
        infoBox.createEl('h4', {
            text: '통합 결과',
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 600;' }
        });
        
        infoBox.createEl('p', {
            text: `"${result.title}" 노트에 ${this.selectedNotes.length}개의 노트 내용이 통합되었습니다.`,
            attr: { style: 'margin: 0 0 0.5rem 0;' }
        });
        
        // 변경사항 미리보기
        this.createContentDiffPreview(container, '원본 내용', '통합 후 내용', result.originalContent, result.newContent);
    }
    
    /**
     * 노트 분할 결과 미리보기 UI 구성
     */
    private buildSplitPreview(container: HTMLElement, result: any) {
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
    private buildAdjustPreview(container: HTMLElement, results: any[]) {
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
            this.createContentDiffPreview(
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
    
    /**
     * 내용 비교 미리보기 UI 생성
     */
    private createContentDiffPreview(
        container: HTMLElement, 
        originalTitle: string, 
        newTitle: string, 
        originalContent: string, 
        newContent: string,
        compact: boolean = false
    ) {
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

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
