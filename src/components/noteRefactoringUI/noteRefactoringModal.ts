import { App, Modal, TFile, Notice } from 'obsidian';
import AILSSPlugin from '../../../main';
import { FrontmatterManager } from '../../core/utils/frontmatterManager';
import { AINoteRefactor } from '../../modules/ai/text/aiNoteRefactor';
import { PathSettings } from '../../core/settings/pathSettings';

// 원자적 컴포넌트 임포트
import { OptionSelectionComponent } from './atomicComponents/OptionSelectionComponent';
import { NoteSearchComponent } from './atomicComponents/NoteSearchComponent';
import { SplitConfirmationComponent } from './atomicComponents/SplitConfirmationComponent';
import { OperationPreviewComponent } from './atomicComponents/OperationPreviewComponent';
import { AIResultPreviewComponent } from './atomicComponents/AIResultPreviewComponent';
import { RefactoringComponentProps, RefactoringOption } from './atomicComponents/types';

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
    private selectedOption: RefactoringOption | null = null;
    private selectedNotes: TFile[] = [];
    private stepContainer: HTMLElement;
    // AI 처리 결과를 저장할 변수
    private aiProcessResult: any = null;
    
    // 컴포넌트 공통 props
    private componentProps: RefactoringComponentProps;

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
        
        // 컴포넌트 공통 props 초기화
        this.componentProps = {
            app: this.app,
            plugin: this.plugin,
            currentFile: this.options.file,
            stepContainer: this.stepContainer,
            selectedOption: this.selectedOption,
            fileId: this.options.id,
            fileTitle: this.options.title
        };
        
        // 첫 단계 표시: 옵션 선택
        this.showOptionSelection();
    }

    /**
     * 옵션 선택 화면을 표시합니다.
     */
    private showOptionSelection(): void {
        this.currentStep = 'selection';
        // 이전 검색 결과 초기화
        this.selectedNotes = [];
        
        // 원자적 컴포넌트 사용
        const optionComponent = new OptionSelectionComponent(
            this.componentProps,
            (option: RefactoringOption) => {
                this.selectedOption = option;
                this.handleOptionSelected(option);
            }
        );
        
        optionComponent.render();
    }
    
    /**
     * 선택된 옵션에 따라 다음 단계를 처리합니다.
     */
    private handleOptionSelected(option: RefactoringOption): void {
        // 컴포넌트 props 업데이트
        this.componentProps.selectedOption = option;
        // 이전에 선택된 노트 초기화
        this.selectedNotes = [];
        
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
    
    /**
     * 노트 검색 화면을 표시합니다.
     */
    private showNoteSearch(placeholder: string, allowMultiple: boolean = false): void {
        this.currentStep = 'search';
        // 이전 선택 초기화
        this.selectedNotes = [];
        
        // 원자적 컴포넌트 사용
        const searchComponent = new NoteSearchComponent(
            this.componentProps,
            // 이전 버튼 콜백
            () => this.showOptionSelection(),
            // 다음 버튼 콜백
            (selectedNotes: TFile[]) => {
                this.selectedNotes = selectedNotes;
                this.showPreview();
            },
            this.selectedNotes // 이미 선택된 노트가 있을 경우
        );
        
        searchComponent.render();
    }
    
    /**
     * 노트 분할 확인 화면을 표시합니다.
     */
    private showSplitConfirmation(): void {
        this.currentStep = 'preview';
        
        // 원자적 컴포넌트 사용
        const splitComponent = new SplitConfirmationComponent(
            this.componentProps,
            // 이전 버튼 콜백
            () => this.showOptionSelection(),
            // 실행 버튼 콜백
            () => this.executeSplit()
        );
        
        splitComponent.render();
    }
    
    /**
     * 작업 미리보기 화면을 표시합니다.
     */
    private showPreview(): void {
        this.currentStep = 'preview';
        
        // 원자적 컴포넌트 사용
        const previewComponent = new OperationPreviewComponent(
            this.componentProps,
            // 이전 버튼 콜백
            () => this.showNoteSearch(
                this.selectedOption === 'merge' ? '통합할 노트를 검색하세요' : '조정할 노트를 검색하세요',
                true
            ),
            // 실행 버튼 콜백
            () => {
                if (this.selectedOption === 'merge') {
                    this.executeMerge();
                } else if (this.selectedOption === 'adjust') {
                    this.executeAdjust();
                }
            },
            this.selectedNotes
        );
        
        previewComponent.render();
    }
    
    /**
     * 노트 통합 실행
     */
    private async executeMerge(): Promise<void> {
        try {
            // AI 통합 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 통합 처리 중...', 0); 
            
            // AINoteRefactor 클래스 사용
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const mergeResult = await aiRefactor.mergeNotes(this.options.file, this.selectedNotes, false);
            
            loadingNotice.hide();
            
            // AI 처리 결과 저장
            this.aiProcessResult = mergeResult;
            
            // 결과 미리보기 표시
            this.showAiResultPreview('merge', mergeResult);
        } catch (error: any) {
            new Notice(`노트 통합 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 통합 준비 오류:', error);
        }
    }
    
    /**
     * 노트 분할 실행
     */
    private async executeSplit(): Promise<void> {
        try {
            // AI 분할 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 분할 처리 중...', 0);
            
            // AINoteRefactor 클래스 사용
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const splitResult = await aiRefactor.splitNote(this.options.file, false);
            
            loadingNotice.hide();
            
            // AI 처리 결과 저장
            this.aiProcessResult = splitResult;
            
            // 결과 미리보기 표시
            this.showAiResultPreview('split', splitResult);
        } catch (error: any) {
            new Notice(`노트 분할 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 분할 준비 오류:', error);
        }
    }
    
    /**
     * 노트 조정 실행
     */
    private async executeAdjust(): Promise<void> {
        try {
            // AI 조정 로직 실행 (미리보기 요청)
            const loadingNotice = new Notice('노트 조정 처리 중...', 0);
            
            // AINoteRefactor 클래스 사용
            const aiRefactor = new AINoteRefactor(this.app, this.plugin);
            const adjustResult = await aiRefactor.adjustNotes(this.options.file, this.selectedNotes, false);
            
            loadingNotice.hide();
            
            // AI 처리 결과 저장
            this.aiProcessResult = adjustResult;
            
            // 결과 미리보기 표시
            this.showAiResultPreview('adjust', adjustResult);
        } catch (error: any) {
            new Notice(`노트 조정 준비 중 오류가 발생했습니다: ${error.message}`);
            console.error('노트 조정 준비 오류:', error);
        }
    }

    /**
     * AI 처리 결과 미리보기 화면을 표시합니다.
     */
    private showAiResultPreview(mode: RefactoringOption, result: any): void {
        this.currentStep = 'aiResult';
        
        // 원자적 컴포넌트 사용
        const aiResultComponent = new AIResultPreviewComponent(
            this.componentProps,
            // 이전 버튼 콜백
            () => {
                if (mode === 'merge' || mode === 'adjust') {
                    this.showNoteSearch(
                        mode === 'merge' ? '통합할 노트를 검색하세요' : '조정할 노트를 검색하세요',
                        true
                    );
                } else if (mode === 'split') {
                    this.showSplitConfirmation();
                }
            },
            // 적용 버튼 콜백
            async () => {
                await this.applyChanges(mode);
            },
            // 취소 버튼 콜백
            () => {
                this.close();
            },
            result
        );
        
        aiResultComponent.render();
    }
    
    /**
     * 변경사항을 적용합니다.
     */
    private async applyChanges(mode: RefactoringOption): Promise<void> {
        const loadingNotice = new Notice('변경사항 적용 중...', 0);
        
        try {
            // 이미 저장된 AI 처리 결과가 있는지 확인
            if (!this.aiProcessResult) {
                throw new Error('AI 처리 결과가 없습니다. 다시 시도해주세요.');
            }
            
            if (mode === 'merge') {
                // 저장된 결과를 사용하여 직접 파일을 수정
                await this.app.vault.modify(this.options.file, this.aiProcessResult.newContent);
                new Notice('노트 통합이 완료되었습니다.');
            } else if (mode === 'split') {
                // 원본 노트 업데이트
                await this.app.vault.modify(this.options.file, this.aiProcessResult.originalFile.newContent);
                
                // 분할된 노트들 생성
                const createdNotes: TFile[] = [];
                
                for (const noteInfo of this.aiProcessResult.newNotes) {
                    // 새 노트 생성
                    const { file } = await PathSettings.createNote({
                        app: this.app,
                        frontmatterConfig: noteInfo.frontmatter,
                        content: noteInfo.content,
                        isInherited: false
                    });
                    
                    createdNotes.push(file);
                }
                
                new Notice(`노트 분할이 완료되었습니다. ${createdNotes.length}개의 새 노트가 생성되었습니다.`);
            } else if (mode === 'adjust') {
                // 각 노트 업데이트
                for (const note of this.aiProcessResult) {
                    await this.app.vault.modify(note.file, note.newContent);
                }
                
                new Notice(`노트 조정이 완료되었습니다. ${this.aiProcessResult.length}개의 노트가 업데이트되었습니다.`);
            }
            
            this.close();
        } catch (error: any) {
            new Notice(`변경사항 적용 중 오류가 발생했습니다: ${error.message}`);
            console.error('변경사항 적용 오류:', error);
        } finally {
            loadingNotice.hide();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
