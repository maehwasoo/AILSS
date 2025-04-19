import { App, Notice, TFile, WorkspaceLeaf, setIcon, MarkdownView, ButtonComponent } from 'obsidian';
import AILSSPlugin from '../../../../main';
import { showTagSelectionDialog } from '../../../components/tagUI/tagSelectionModal';

export class NoteRecall {
    private currentIndex: number = 0;
    private files: TFile[] = [];
    private navigationBarElement: HTMLElement | null = null;
    private statusTextElement: HTMLElement | null = null;
    private isActive: boolean = false;
    private boundHandleKeyDown: (event: KeyboardEvent) => void;

    constructor(private app: App, private plugin: AILSSPlugin) {
        // 이벤트 핸들러를 바인딩하여 저장
        this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    }

    /**
     * 태그 입력을 받거나 전체 노트를 기반으로 노트 복기 시작
     */
    async main() {
        // 이미 활성화된 상태라면 종료
        if (this.isActive) {
            this.exitRecallMode();
            return;
        }

        const tags = await showTagSelectionDialog(this.app, {
            title: '노트 복기',
            placeholder: '태그를 입력하세요 (비워두면 전체 노트)',
            confirmText: '복기 시작',
            cancelText: '취소'
        });

        // 태그를 기반으로 노트를 필터링하거나 전체 노트 사용
        this.files = this.getFiles(tags);
        
        if (this.files.length === 0) {
            // 파일이 없을 경우 경고 표시
            new Notice('복기할 노트가 없습니다.');
            return;
        }

        // 복기 모드 활성화
        this.isActive = true;
        this.currentIndex = 0;
        
        // 네비게이션 바 생성
        this.createNavigationBar();
        
        // 키보드 이벤트 리스너 추가
        this.registerKeyboardEvents();
        
        // 첫 번째 노트 열기
        this.openCurrentNote();
    }

    /**
     * 태그 목록을 기반으로 해당하는 마크다운 파일 목록을 가져옵니다.
     * 태그 목록이 비어있으면 전체 마크다운 파일을 가져옵니다.
     */
    private getFiles(tags: string[]): TFile[] {
        const markdownFiles = this.app.vault.getMarkdownFiles();

        if (tags.length === 0) {
            return markdownFiles;
        }

        return markdownFiles.filter(file => {
            // 파일의 캐시된 메타데이터 확인
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache || !cache.tags) return false;

            // 파일에 지정된 태그가 하나라도 포함되어 있는지 확인
            return tags.some(tag => {
                const searchTag = tag.startsWith('#') ? tag : `#${tag}`;
                return cache.tags?.some(t => t.tag === searchTag);
            });
        });
    }

    /**
     * 노트 복기 네비게이션 바 생성
     */
    private createNavigationBar() {
        // 기존 네비게이션 바가 있다면 제거
        if (this.navigationBarElement) {
            this.navigationBarElement.remove();
            this.navigationBarElement = null;
            this.statusTextElement = null;
        }

        // 워크스페이스 상단에 네비게이션 바 추가
        const workspaceEl = document.querySelector('.workspace-leaf.mod-active');
        if (!workspaceEl) {
            // 활성화된 워크스페이스 리프가 없는 경우 기본 방식으로 진행
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) return;
            
            this.navigationBarElement = view.containerEl.createDiv({ cls: 'note-recall-editor-navbar' });
        } else {
            this.navigationBarElement = workspaceEl.createDiv({ cls: 'note-recall-editor-navbar' });
            
            // 스타일 설정
            if (this.navigationBarElement) {
                this.navigationBarElement.style.position = 'absolute';
                this.navigationBarElement.style.top = '0';
                this.navigationBarElement.style.left = '0';
                this.navigationBarElement.style.width = '100%';
                this.navigationBarElement.style.zIndex = '1000';
            }
        }

        // 왼쪽 버튼
        const leftButton = new ButtonComponent(this.navigationBarElement);
        leftButton.setIcon('arrow-left');
        leftButton.setTooltip('이전 노트');
        leftButton.onClick(() => this.navigateToIndex(this.currentIndex - 1));

        // 상태 텍스트 (현재 위치/전체)
        this.statusTextElement = this.navigationBarElement.createDiv({ cls: 'note-recall-status' });
        this.updateStatusText();

        // 오른쪽 버튼
        const rightButton = new ButtonComponent(this.navigationBarElement);
        rightButton.setIcon('arrow-right');
        rightButton.setTooltip('다음 노트');
        rightButton.onClick(() => this.navigateToIndex(this.currentIndex + 1));

        // 여백 추가
        if (this.navigationBarElement) {
            const spacer = this.navigationBarElement.createDiv({ cls: 'note-recall-spacer' });
            spacer.style.display = 'inline-block';
            spacer.style.width = '10px';
        }

        // 종료 버튼
        const exitButton = new ButtonComponent(this.navigationBarElement);
        exitButton.setIcon('x');
        exitButton.setTooltip('복기 모드 종료');
        exitButton.onClick(() => this.exitRecallMode());
    }

    /**
     * 키보드 이벤트 등록
     */
    private registerKeyboardEvents() {
        // DOM 기반 이벤트 리스너 등록
        document.addEventListener('keydown', this.boundHandleKeyDown);
    }

    /**
     * 키보드 이벤트 핸들러
     */
    private handleKeyDown(event: KeyboardEvent) {
        if (!this.isActive) return;

        if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey) {
            this.navigateToIndex(this.currentIndex - 1);
            event.preventDefault();
        } else if (event.key === 'ArrowRight' && !event.ctrlKey && !event.metaKey) {
            this.navigateToIndex(this.currentIndex + 1);
            event.preventDefault();
        } else if (event.key === 'Escape') {
            this.exitRecallMode();
            event.preventDefault();
        }
    }

    /**
     * 현재 인덱스의 노트를 에디터에 엽니다.
     */
    private async openCurrentNote() {
        if (!this.isActive || this.files.length === 0) return;

        const file = this.files[this.currentIndex];
        if (!file) return;

        try {
            // 파일을 현재 활성화된 에디터에 엽니다
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file, { active: true });
            
            // 스크롤을 맨 위로 이동
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) {
                view.editor.scrollTo(0, 0);
            }

            // 상태 표시 업데이트
            this.updateStatusText();
        } catch (error) {
            console.error('노트를 열 수 없습니다:', error);
            new Notice('노트를 열 수 없습니다.');
        }
    }

    /**
     * 주어진 인덱스로 노트 이동
     */
    private navigateToIndex(index: number) {
        if (!this.isActive) return;

        if (index < 0) {
            // 처음 노트에서 이전으로 가면 마지막 노트로
            this.currentIndex = this.files.length - 1;
        } else if (index >= this.files.length) {
            // 마지막 노트에서 다음으로 가면 처음 노트로
            this.currentIndex = 0;
        } else {
            this.currentIndex = index;
        }

        this.openCurrentNote();
    }

    /**
     * 상태 텍스트 업데이트
     */
    private updateStatusText() {
        if (!this.statusTextElement || !this.isActive) return;
        
        const file = this.files[this.currentIndex];
        if (!file) return;
        
        this.statusTextElement.textContent = `${file.basename} (${this.currentIndex + 1}/${this.files.length})`;
    }

    /**
     * 노트 복기 모드 종료
     */
    private exitRecallMode() {
        this.isActive = false;

        // 네비게이션 바 제거
        if (this.navigationBarElement) {
            this.navigationBarElement.remove();
            this.navigationBarElement = null;
            this.statusTextElement = null;
        }

        // 키보드 이벤트 리스너 제거
        document.removeEventListener('keydown', this.boundHandleKeyDown);

        // 알림 표시
        new Notice('노트 복기 모드를 종료했습니다.');
    }
}
