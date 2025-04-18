import { App, Modal, TFile, Notice, setIcon } from 'obsidian';
import AILSSPlugin from '../../main';
import { FrontmatterManager } from '../modules/maintenance/utils/frontmatterManager';
import { UpdateTags } from '../modules/command/update/updateTags';

/**
 * 태그 동기화 작업을 위한 모달
 * 현재 노트의 태그를 연결된 노트에 추가, 삭제 또는 변경하는 기능 제공
 */
export class TagSyncModal extends Modal {
    /**
     * 현재 활성화된 노트에 대해 태그 동기화 모달을 엽니다.
     * @param app Obsidian 앱 인스턴스
     * @param plugin AILSS 플러그인 인스턴스
     */
    static openForActiveNote(app: App, plugin: AILSSPlugin): void {
        const activeFile = app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('활성화된 노트가 없습니다.');
            return;
        }

        // 현재 파일의 frontmatter와 태그 읽기
        app.vault.read(activeFile).then((content) => {
            const frontmatterManager = new FrontmatterManager();
            const frontmatter = frontmatterManager.parseFrontmatter(content);
            
            if (!frontmatter) {
                new Notice('노트의 프론트매터를 찾을 수 없습니다.');
                return;
            }

            const title = frontmatter.title || activeFile.basename;
            const tags = frontmatter.tags || [];
            
            if (!Array.isArray(tags)) {
                new Notice('태그 형식이 올바르지 않습니다.');
                return;
            }
            
            // 태그가 없는 경우
            if (tags.length === 0) {
                new Notice('현재 노트에 태그가 없습니다. 동기화할 태그를 먼저 추가해주세요.');
                return;
            }

            // 모달 열기
            new TagSyncModal(app, plugin, activeFile, title, tags).open();
        });
    }

    private plugin: AILSSPlugin;
    private file: TFile;
    private title: string;
    private tags: string[];
    private selectedOption: 'add' | 'remove' | 'replace' | null = null;
    private useRecursive: boolean = false; // 재귀 옵션 추가

    constructor(app: App, plugin: AILSSPlugin, file: TFile, title: string, tags: string[]) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.title = title;
        this.tags = tags;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "tag-sync-container",
            attr: { style: "padding: 2rem;" }
        });
        
        // 헤더 영역
        const headerContainer = container.createDiv({
            cls: "header-container",
            attr: { style: "display: flex; flex-direction: column; align-items: center; margin-bottom: 1.5rem;" }
        });
        
        // 타이틀
        headerContainer.createEl('h2', { 
            text: this.title,
            attr: { style: "margin: 0 0 0.5rem 0; font-size: 1.5em; text-align: center;" }
        });
        
        // 현재 태그 표시
        const tagsDisplay = headerContainer.createDiv({
            attr: { style: "font-size: 0.9em; color: var(--text-muted); text-align: center;" }
        });
        
        // 태그 배지 스타일로 표시
        if (this.tags.length > 0) {
            this.tags.forEach(tag => {
                const tagBadge = tagsDisplay.createSpan({
                    cls: "tag-badge",
                    text: tag,
                    attr: {
                        style: "background-color: var(--interactive-accent); color: var(--text-on-accent); padding: 2px 8px; border-radius: 10px; margin: 0 4px 4px 0; display: inline-block;"
                    }
                });
            });
        }
        
        // 구분선
        container.createEl('hr', { attr: { style: "margin-bottom: 1.5rem;" } });
        
        // 옵션 선택 UI
        this.showOptionSelection(container);
    }

    private showOptionSelection(container: HTMLElement) {
        // 제목
        container.createEl('h3', { 
            text: '태그 동기화 옵션',
            attr: { style: "margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;" }
        });
        
        // 옵션 버튼 컨테이너
        const optionsContainer = container.createDiv({
            cls: 'tag-sync-options',
            attr: {
                style: 'display: flex; gap: 1rem; margin-bottom: 2rem; width: 100%;'
            }
        });
        
        // 추가 버튼
        this.createOptionButton(optionsContainer, 'add', '추가', 'plus');
        
        // 삭제 버튼
        this.createOptionButton(optionsContainer, 'remove', '삭제', 'minus');
        
        // 변경 버튼
        this.createOptionButton(optionsContainer, 'replace', '변경', 'refresh-ccw');
        
        // 옵션 설명 텍스트 컨테이너
        const descriptionContainer = container.createDiv({ 
            cls: 'options-descriptions',
            attr: { style: 'display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;' }
        });
        
        // 추가 설명
        this.createOptionDescription(
            descriptionContainer,
            '추가',
            '현재 노트의 태그를 연결된 모든 노트에 추가합니다. 이미 있는 태그는 건너뜁니다.'
        );
        
        // 삭제 설명
        this.createOptionDescription(
            descriptionContainer,
            '삭제',
            '현재 노트의 태그를 연결된 모든 노트에서 삭제합니다. 없는 태그는 건너뜁니다.'
        );
        
        // 변경 설명
        this.createOptionDescription(
            descriptionContainer,
            '변경',
            '연결된 모든 노트의 태그를 현재 노트의 태그로 완전히 교체합니다. 기존 태그는 모두 삭제됩니다.'
        );
    }
    
    private createOptionButton(container: HTMLElement, option: 'add' | 'remove' | 'replace', text: string, iconName: string) {
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
            this.showConfirmation(option);
        });
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
    
    private showConfirmation(option: 'add' | 'remove' | 'replace') {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "tag-sync-container",
            attr: { style: "padding: 2rem;" }
        });
        
        // 헤더
        container.createEl('h2', { 
            text: '태그 동기화 확인',
            attr: { style: "margin: 0 0 1.5rem 0; font-size: 1.5em; text-align: center;" }
        });
        
        // 경고 메시지
        const warningBox = container.createDiv({
            cls: 'warning-box',
            attr: { 
                style: 'background-color: rgba(var(--background-modifier-error-rgb), 0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; text-align: center;' 
            }
        });
        
        // 옵션별 메시지
        let message = '';
        switch(option) {
            case 'add':
                message = `현재 노트의 태그(${this.tags.join(', ')})를 연결된 모든 노트에 추가하시겠습니까?`;
                break;
            case 'remove':
                message = `현재 노트의 태그(${this.tags.join(', ')})를 연결된 모든 노트에서 삭제하시겠습니까?`;
                break;
            case 'replace':
                message = `연결된 모든 노트의 태그를 현재 노트의 태그(${this.tags.join(', ')})로 변경하시겠습니까?`;
                break;
        }
        
        warningBox.createEl('p', { 
            text: message,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 500;' } 
        });
        
        warningBox.createEl('p', { 
            text: '이 작업은 연결된 모든 노트의 태그를 수정합니다.',
            attr: { style: 'margin: 0; font-weight: 400; color: var(--text-error);' } 
        });
        
        // 재귀 옵션 추가
        const recursiveOption = container.createDiv({
            attr: { style: 'display: flex; align-items: center; margin: 1.5rem 0; padding: 0.8rem; background-color: var(--background-secondary); border-radius: 8px;' }
        });
        
        const recursiveCheckbox = recursiveOption.createEl('input', {
            attr: { 
                type: 'checkbox',
                id: 'recursive-option',
                style: 'margin-right: 10px; width: 16px; height: 16px;' 
            }
        });
        
        recursiveOption.createEl('label', {
            text: '재귀적으로 적용 (2단계 이상 떨어진 노트에도 적용)',
            attr: { 
                for: 'recursive-option',
                style: 'font-weight: 500; cursor: pointer;' 
            }
        });
        
        recursiveCheckbox.addEventListener('change', (e) => {
            this.useRecursive = (e.target as HTMLInputElement).checked;
        });
        
        // 버튼 컨테이너
        const buttonContainer = container.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem; margin-top: 2rem;' }
        });
        
        // 취소 버튼
        const cancelButton = buttonContainer.createEl('button', {
            text: '취소',
            attr: { style: 'padding: 0.8rem 1.5rem; flex: 1; border-radius: 4px;' }
        });
        
        // 실행 버튼
        const actionText = option === 'add' ? '추가하기' : option === 'remove' ? '삭제하기' : '변경하기';
        const executeButton = buttonContainer.createEl('button', {
            text: actionText,
            cls: 'mod-cta',
            attr: { style: 'padding: 0.8rem 1.5rem; flex: 1; border-radius: 4px;' }
        });
        
        // 이벤트 리스너
        cancelButton.addEventListener('click', () => {
            this.close();
        });
        
        executeButton.addEventListener('click', async () => {
            const updateTags = new UpdateTags(this.app, this.plugin);
            try {
                let result = false;
                
                switch(option) {
                    case 'add':
                        result = await updateTags.addTagsToLinkedNotes(this.file, this.tags, this.useRecursive);
                        break;
                    case 'remove':
                        result = await updateTags.removeTagsFromLinkedNotes(this.file, this.tags, this.useRecursive);
                        break;
                    case 'replace':
                        result = await updateTags.replaceTagsInLinkedNotes(this.file, this.tags, this.useRecursive);
                        break;
                }
                
                if (result) {
                    let successMessage = '';
                    switch(option) {
                        case 'add': 
                            successMessage = '태그가 연결된 노트에 추가되었습니다.'; 
                            break;
                        case 'remove': 
                            successMessage = '태그가 연결된 노트에서 삭제되었습니다.'; 
                            break;
                        case 'replace': 
                            successMessage = '연결된 노트의 태그가 변경되었습니다.'; 
                            break;
                    }
                    new Notice(successMessage);
                } else {
                    new Notice('태그 동기화 중 문제가 발생했습니다.');
                }
                
                this.close();
            } catch (error) {
                console.error('태그 동기화 중 오류:', error);
                new Notice(`태그 동기화 중 오류가 발생했습니다: ${error.message || error}`);
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}