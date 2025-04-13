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
    private currentStep: 'selection' | 'search' | 'preview' = 'selection';
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
        
        // 제목 설정
        contentEl.createEl('h2', { text: '노트 리팩토링' });
        
        // 현재 노트 정보 표시
        const infoContainer = contentEl.createDiv({ cls: 'note-refactoring-info' });
        infoContainer.createEl('p', { text: `현재 노트: ${this.options.title}` });
        infoContainer.createEl('p', { text: `ID: ${this.options.id}` });
        
        // 스텝 컨테이너 생성
        this.stepContainer = contentEl.createDiv({ cls: 'note-refactoring-steps' });
        
        // 첫 단계 표시: 옵션 선택
        this.showOptionSelection();
    }

    private showOptionSelection() {
        this.currentStep = 'selection';
        this.stepContainer.empty();
        
        const optionsContainer = this.stepContainer.createDiv({
            cls: 'note-refactoring-options',
            attr: {
                style: 'display: flex; gap: 10px; margin-top: 20px; margin-bottom: 20px;'
            }
        });
        
        // 통합 버튼
        this.createOptionButton(optionsContainer, 'merge', '통합', 'merge');
        
        // 분할 버튼
        this.createOptionButton(optionsContainer, 'split', '분할', 'scissors');
        
        // 조정 버튼
        this.createOptionButton(optionsContainer, 'adjust', '조정', 'settings');
        
        // 옵션 설명
        const descriptionContainer = this.stepContainer.createDiv({ cls: 'note-refactoring-description' });
        descriptionContainer.createEl('p', { 
            text: '옵션을 선택하세요:',
            attr: { style: 'font-weight: bold; margin-bottom: 10px;' }
        });
        
        descriptionContainer.createEl('p', { 
            text: '• 통합: 현재 노트에 다른 노트 내용을 통합하여 재구성합니다.',
            attr: { style: 'margin-bottom: 5px;' }
        });
        
        descriptionContainer.createEl('p', { 
            text: '• 분할: 현재 노트의 내용을 기반으로 새로운 노트들로 분리합니다.',
            attr: { style: 'margin-bottom: 5px;' }
        });
        
        descriptionContainer.createEl('p', { 
            text: '• 조정: 현재 노트와 선택된 노트들 간의 내용을 주제별로 재조정합니다.',
            attr: { style: 'margin-bottom: 5px;' }
        });
    }
    
    private createOptionButton(container: HTMLElement, option: 'merge' | 'split' | 'adjust', text: string, iconName: string) {
        const button = container.createEl('button', {
            cls: 'mod-cta',
            attr: {
                style: 'display: flex; align-items: center; justify-content: center; padding: 25px 20px; min-height: 80px; flex: 1;'
            }
        });
        
        // 아이콘과 텍스트를 하나의 컨테이너로 묶음
        const contentContainer = button.createDiv({
            attr: { style: 'display: flex; align-items: center; justify-content: center; gap: 8px;' }
        });
        
        // 아이콘 컨테이너
        const iconContainer = contentContainer.createDiv({
            attr: { style: 'font-size: 24px;' }
        });
        setIcon(iconContainer, iconName);
        
        // 텍스트 추가
        contentContainer.createSpan({ text: text });
        
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
            attr: { style: 'margin-bottom: 15px;' }
        });
        
        // 검색 필드
        const searchInputContainer = searchContainer.createDiv({
            attr: { style: 'margin-bottom: 15px;' }
        });
        
        this.searchInput = searchInputContainer.createEl('input', {
            attr: {
                type: 'text',
                placeholder: placeholder,
                style: 'width: 100%; padding: 8px;'
            }
        });
        
        // 검색 실행 버튼
        const searchButton = searchInputContainer.createEl('button', {
            text: '검색',
            cls: 'mod-cta',
            attr: { style: 'margin-top: 8px;' }
        });
        
        // 검색 결과 컨테이너
        this.searchResults = searchContainer.createDiv({
            cls: 'search-results',
            attr: { style: 'max-height: 300px; overflow-y: auto; margin-bottom: 15px;' }
        });
        
        // 선택된 노트들 표시 컨테이너
        const selectedNotesContainer = searchContainer.createDiv({
            cls: 'selected-notes',
            attr: { style: 'margin-bottom: 15px;' }
        });
        
        selectedNotesContainer.createEl('h4', { text: '선택된 노트', attr: { style: 'margin-bottom: 5px;' } });
        const selectedNotesList = selectedNotesContainer.createEl('ul', { attr: { style: 'padding-left: 20px;' } });
        
        // 버튼 컨테이너
        const buttonContainer = searchContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 8px 16px;' }
        });
        
        // 다음 버튼
        const nextButton = buttonContainer.createEl('button', {
            text: '다음',
            cls: 'mod-cta',
            attr: { style: 'padding: 8px 16px;' }
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
                selectedNotesList.createEl('li', { text: '선택된 노트 없음' });
                nextButton.disabled = true;
            } else {
                this.selectedNotes.forEach(file => {
                    const item = selectedNotesList.createEl('li');
                    const fileDisplay = item.createSpan({ text: file.basename });
                    
                    const removeButton = item.createEl('button', {
                        text: '제거',
                        attr: { style: 'margin-left: 8px; font-size: 0.8em;' }
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
            this.searchResults.createEl('p', { text: '검색 결과가 없습니다.' });
            return;
        }
        
        // 검색 결과 표시
        const resultList = this.searchResults.createEl('ul', { attr: { style: 'list-style: none; padding: 0;' } });
        
        results.slice(0, 10).forEach(file => {
            const item = resultList.createEl('li', { attr: { style: 'padding: 8px; margin-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border);' } });
            
            const fileLink = item.createEl('div', {
                text: file.basename,
                attr: { style: 'font-weight: bold;' }
            });
            
            item.createEl('div', {
                text: file.path,
                attr: { style: 'font-size: 0.8em; color: var(--text-muted);' }
            });
            
            const selectButton = item.createEl('button', {
                text: '선택',
                cls: 'mod-cta',
                attr: { style: 'margin-top: 4px; font-size: 0.9em;' }
            });
            
            selectButton.addEventListener('click', () => {
                this.handleSearchResult(file);
            });
        });
        
        if (results.length > 10) {
            this.searchResults.createEl('p', { text: `...외 ${results.length - 10}개 결과` });
        }
    }
    
    private showSplitConfirmation() {
        this.currentStep = 'preview';
        this.stepContainer.empty();
        
        const confirmContainer = this.stepContainer.createDiv({ cls: 'split-confirmation' });
        
        confirmContainer.createEl('h3', { text: '노트 분할', attr: { style: 'margin-bottom: 15px;' } });
        
        confirmContainer.createEl('p', { 
            text: '현재 노트를 분할하시겠습니까?', 
            attr: { style: 'margin-bottom: 10px;' } 
        });
        
        confirmContainer.createEl('p', { 
            text: `"${this.options.title}" 노트의 내용을 분석하여 주제별로 분할하고 새로운 노트들을 생성합니다.`,
            attr: { style: 'margin-bottom: 20px;' } 
        });
        
        const infoBox = confirmContainer.createDiv({
            cls: 'info-box',
            attr: { style: 'background-color: var(--background-modifier-form-field); padding: 10px; border-radius: 5px; margin-bottom: 20px;' }
        });
        
        infoBox.createEl('p', { 
            text: '• 현재 노트의 제목과 관련된 내용만 유지합니다.',
            attr: { style: 'margin-bottom: 5px;' } 
        });
        
        infoBox.createEl('p', { 
            text: '• 다른 주제의 내용은 새로운 노트로 분할됩니다.',
            attr: { style: 'margin-bottom: 5px;' } 
        });
        
        infoBox.createEl('p', { 
            text: '• 분할된 노트들은 서로 링크됩니다.',
            attr: { style: 'margin-bottom: 5px;' } 
        });
        
        // 버튼 컨테이너
        const buttonContainer = confirmContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; margin-top: 20px;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 8px 16px;' }
        });
        
        // 실행 버튼
        const executeButton = buttonContainer.createEl('button', {
            text: '분할 실행',
            cls: 'mod-cta',
            attr: { style: 'padding: 8px 16px;' }
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
        this.previewContainer.createEl('h3', { text: operationTitle, attr: { style: 'margin-bottom: 15px;' } });
        
        // 선택된 노트 정보
        const selectionInfo = this.previewContainer.createDiv({ cls: 'selection-info' });
        
        selectionInfo.createEl('h4', { 
            text: '처리할 노트들', 
            attr: { style: 'margin-bottom: 10px;' } 
        });
        
        const notesList = selectionInfo.createEl('ul', { attr: { style: 'margin-bottom: $2px; padding-left: 20px;' } });
        
        // 현재 노트 추가
        notesList.createEl('li', { 
            text: `${this.options.title} (현재 노트)`,
            attr: { style: 'font-weight: bold;' } 
        });
        
        // 선택된 다른 노트들
        this.selectedNotes.forEach(file => {
            notesList.createEl('li', { text: file.basename });
        });
        
        // 작업 설명
        const operationDescription = this.previewContainer.createDiv({ 
            cls: 'operation-description',
            attr: { style: 'margin-top: 20px; margin-bottom: 20px;' } 
        });
        
        if (this.selectedOption === 'merge') {
            operationDescription.createEl('p', { 
                text: '선택한 노트들의 내용이 현재 노트에 통합되어 체계적으로 재구성됩니다.',
                attr: { style: 'margin-bottom: 10px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 현재 노트와 선택한 노트들의 내용이 모두 병합됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 중복된 내용은 자동으로 제거되고 관련 내용끼리 그룹화됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 통합된 내용은 논리적으로 재구성되어 현재 노트에 저장됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
        } else { // adjust
            operationDescription.createEl('p', { 
                text: '선택한 노트들의 내용이 주제별로 재분배됩니다.',
                attr: { style: 'margin-bottom: 10px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 각 노트의 제목과 관련된 내용만 해당 노트에 유지됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 다른 주제에 관련된 내용은 적절한 노트로 이동됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
            
            operationDescription.createEl('p', { 
                text: '• 새로운 내용은 추가되지 않고 기존 내용만 재분배됩니다.',
                attr: { style: 'margin-bottom: 5px;' } 
            });
        }
        
        // 주의사항
        const warningBox = this.previewContainer.createDiv({
            cls: 'warning-box',
            attr: { 
                style: 'background-color: var(--background-modifier-error-rgb); opacity: 0.2; padding: 10px; border-radius: 5px; margin-bottom: 20px;' 
            }
        });
        
        warningBox.createEl('p', { 
            text: '이 작업은 선택한 노트들의 내용을 변경합니다. 계속하시겠습니까?',
            attr: { style: 'font-weight: bold; margin-bottom: 0;' } 
        });
        
        // 버튼 컨테이너
        const buttonContainer = this.previewContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; margin-top: 20px;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 8px 16px;' }
        });
        
        // 실행 버튼
        const executeButton = buttonContainer.createEl('button', {
            text: this.selectedOption === 'merge' ? '통합 실행' : '조정 실행',
            cls: 'mod-cta',
            attr: { style: 'padding: 8px 16px;' }
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
    
    private executeMerge() {
        // AI 통합 로직 실행
        new Notice('노트 통합 처리 중...');
        this.close();
        
        // 통합 처리 실행 - AINoteRefactor 클래스 사용
        this.plugin.noteRefactoringManager.mergeNotes(this.options.file, this.selectedNotes)
            .then(() => {
                new Notice('노트 통합이 완료되었습니다.');
            })
            .catch(error => {
                new Notice(`노트 통합 중 오류가 발생했습니다: ${error.message}`);
                console.error('노트 통합 오류:', error);
            });
    }
    
    private executeSplit() {
        // AI 분할 로직 실행
        new Notice('노트 분할 처리 중...');
        this.close();
        
        // 분할 처리 실행 - AINoteRefactor 클래스 사용
        this.plugin.noteRefactoringManager.splitNote(this.options.file)
            .then(() => {
                new Notice('노트 분할이 완료되었습니다.');
            })
            .catch(error => {
                new Notice(`노트 분할 중 오류가 발생했습니다: ${error.message}`);
                console.error('노트 분할 오류:', error);
            });
    }
    
    private executeAdjust() {
        // AI 조정 로직 실행
        new Notice('노트 조정 처리 중...');
        this.close();
        
        // 조정 처리 실행 - AINoteRefactor 클래스 사용
        this.plugin.noteRefactoringManager.adjustNotes(this.options.file, this.selectedNotes)
            .then(() => {
                new Notice('노트 조정이 완료되었습니다.');
            })
            .catch(error => {
                new Notice(`노트 조정 중 오류가 발생했습니다: ${error.message}`);
                console.error('노트 조정 오류:', error);
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
