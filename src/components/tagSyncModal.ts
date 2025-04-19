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
    private allTags: string[];
    private selectedTags: string[];
    private selectedOption: 'add' | 'remove' | 'replace' | null = null;
    private useRecursive: boolean = true; // 재귀 옵션 기본값을 true로 변경

    constructor(app: App, plugin: AILSSPlugin, file: TFile, title: string, tags: string[]) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.title = title;
        this.allTags = tags;
        this.selectedTags = [...tags]; // 초기에는 모든 태그가 선택된 상태
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "tag-sync-container",
            attr: { style: "padding: 1.5rem;" } // 2rem에서 1.5rem으로 패딩 줄임
        });
        
        // 헤더 영역
        const headerContainer = container.createDiv({
            cls: "header-container",
            attr: { style: "display: flex; flex-direction: column; align-items: center; margin-bottom: 1rem;" } // 1.5rem에서 1rem으로 마진 줄임
        });
        
        // 타이틀
        headerContainer.createEl('h2', { 
            text: this.title,
            attr: { style: "margin: 0 0 0.7rem 0; font-size: 1.4em; text-align: center;" } // 마진과 폰트 사이즈 줄임
        });
        
        // 태그 선택 UI 추가
        const tagsSelectionContainer = container.createDiv({
            cls: 'tags-selection-container',
            attr: { style: 'margin-bottom: 1.5rem; text-align: center;' }
        });

        // 태그 선택 UI
        const tagListContainer = tagsSelectionContainer.createDiv({
            attr: { style: 'display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center;' }
        });

        // 모든 태그를 선택 가능한 태그 아이템으로 표시
        this.allTags.forEach(tag => {
            const isSelected = this.selectedTags.includes(tag);
            const tagEl = tagListContainer.createDiv({
                cls: 'tag-item',
                text: tag,
                attr: { 
                    style: `
                        padding: 0.3rem 0.8rem; 
                        border-radius: 1rem; 
                        cursor: pointer; 
                        transition: all 0.2s ease;
                        background-color: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
                        color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
                    `
                }
            });

            // 클릭 이벤트
            tagEl.addEventListener('click', () => {
                const tagIndex = this.selectedTags.indexOf(tag);
                
                if (tagIndex > -1) {
                    // 이미 선택된 태그면 제거
                    this.selectedTags.splice(tagIndex, 1);
                    tagEl.style.backgroundColor = 'var(--background-secondary)';
                    tagEl.style.color = 'var(--text-normal)';
                } else {
                    // 선택되지 않은 태그면 추가
                    this.selectedTags.push(tag);
                    tagEl.style.backgroundColor = 'var(--interactive-accent)';
                    tagEl.style.color = 'var(--text-on-accent)';
                }
            });

            // 마우스 호버 효과
            tagEl.addEventListener('mouseenter', () => {
                if (!this.selectedTags.includes(tag)) {
                    tagEl.style.backgroundColor = 'var(--background-modifier-hover)';
                }
            });

            tagEl.addEventListener('mouseleave', () => {
                if (!this.selectedTags.includes(tag)) {
                    tagEl.style.backgroundColor = 'var(--background-secondary)';
                }
            });
        });

        // 태그가 하나도 선택되지 않았을 때 안내 메시지
        const noTagsSelectedWarning = tagsSelectionContainer.createDiv({
            cls: 'no-tags-warning',
            attr: { 
                style: `
                    margin-top: 0.8rem; 
                    color: var(--text-error); 
                    font-size: 0.9em;
                    display: ${this.selectedTags.length === 0 ? 'block' : 'none'};
                `
            }
        });
        
        noTagsSelectedWarning.createSpan({
            text: '※ 적어도 하나의 태그를 선택해주세요.'
        });

        // 태그 선택 상태 변경 감지
        const updateTagSelectionState = () => {
            if (this.selectedTags.length === 0) {
                noTagsSelectedWarning.style.display = 'block';
            } else {
                noTagsSelectedWarning.style.display = 'none';
            }
        };

        // 구분선
        container.createEl('hr', { attr: { style: "margin-bottom: 1rem;" } }); // 1.5rem에서 1rem으로 마진 줄임
        
        // 옵션 선택 UI
        this.showOptionSelection(container);
    }

    private showOptionSelection(container: HTMLElement) {
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
        
        // 추가 설명 (줄바꿈 추가)
        this.createOptionDescription(
            descriptionContainer,
            '추가',
            '선택한 태그를 연결된 모든 노트에 추가합니다.\n이미 있는 태그는 건너뜁니다.'
        );
        
        // 삭제 설명 (줄바꿈 추가)
        this.createOptionDescription(
            descriptionContainer,
            '삭제',
            '선택한 태그를 연결된 모든 노트에서 삭제합니다.\n없는 태그는 건너뜁니다.'
        );
        
        // 변경 설명 (줄바꿈 추가)
        this.createOptionDescription(
            descriptionContainer,
            '변경',
            '연결된 모든 노트의 태그를 선택한 태그로 완전히 교체합니다.\n기존 태그는 모두 삭제됩니다.'
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
            // 선택된 태그가 없으면 작업 불가
            if (this.selectedTags.length === 0) {
                new Notice('적어도 하나의 태그를 선택해주세요.');
                return;
            }
            
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
        
        // 설명 (줄바꿈 처리)
        const lines = description.split('\n');
        const paragraphContainer = descItem.createDiv({
            attr: { style: 'margin: 0; color: var(--text-muted);' }
        });
        
        lines.forEach((line, index) => {
            paragraphContainer.createEl('p', {
                text: line,
                attr: { style: 'margin: ' + (index === 0 ? '0 0 0.3rem 0' : '0') }
            });
        });
    }
    
    private showConfirmation(option: 'add' | 'remove' | 'replace') {
        const { contentEl } = this;
        contentEl.empty();
        
        const container = contentEl.createDiv({
            cls: "tag-sync-container",
            attr: { style: "padding: 1.5rem;" } // 2rem에서 1.5rem으로 패딩 줄임
        });
        
        // 헤더
        container.createEl('h2', { 
            text: '태그 동기화 확인',
            attr: { style: "margin: 0 0 0.7rem 0; font-size: 1.4em; text-align: center;" } // 마진과 폰트 사이즈 줄임
        });
        
        // 선택된 태그 표시 (캡슐 형태로)
        const selectedTagsDisplay = container.createDiv({
            attr: { style: "text-align: center; margin-bottom: 1.2rem;" } // 1.5rem에서 1.2rem으로 마진 줄임
        });
        
        this.selectedTags.forEach(tag => {
            selectedTagsDisplay.createSpan({
                cls: "tag-badge",
                text: tag,
                attr: {
                    style: "background-color: var(--interactive-accent); color: var(--text-on-accent); padding: 3px 10px; border-radius: 12px; margin: 0 4px 4px 0; display: inline-block;"
                }
            });
        });
        
        // 경고 메시지
        const warningBox = container.createDiv({
            cls: 'warning-box',
            attr: { 
                style: 'background-color: rgba(var(--background-modifier-error-rgb), 0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1.2rem; text-align: center;' // 1.5rem에서 1.2rem으로 마진 줄임
            }
        });
        
        // 옵션별 메시지 (재귀적 적용 여부에 따라 메시지 변경)
        let mainMessage = '';
        let subMessage = '';
        const targetDesc = this.useRecursive ? '연결된 모든 노트' : '직접 연결된 노트';
        
        switch(option) {
            case 'add':
                mainMessage = `선택한 태그를 ${targetDesc}에 추가하시겠습니까?`;
                subMessage = `이 작업은 ${targetDesc}의 태그를 수정합니다.`;
                break;
            case 'remove':
                mainMessage = `선택한 태그를 ${targetDesc}에서 삭제하시겠습니까?`;
                subMessage = `이 작업은 ${targetDesc}의 태그를 수정합니다.`;
                break;
            case 'replace':
                mainMessage = `${targetDesc}의 태그를 선택한 태그로 변경하시겠습니까?`;
                subMessage = `이 작업은 ${targetDesc}의 태그를 완전히 대체합니다.`;
                break;
        }
        
        warningBox.createEl('p', { 
            text: mainMessage,
            attr: { style: 'margin: 0 0 0.5rem 0; font-weight: 500;' } 
        });
        
        warningBox.createEl('p', { 
            text: subMessage,
            attr: { style: 'margin: 0; font-weight: 400; color: var(--text-error);' } 
        });
        
        // 재귀 옵션 추가
        const recursiveOption = container.createDiv({
            attr: { style: 'display: flex; align-items: center; margin: 1.2rem 0; padding: 0.8rem; background-color: var(--background-secondary); border-radius: 8px;' } // 1.5rem에서 1.2rem으로 마진 줄임
        });
        
        const recursiveCheckbox = recursiveOption.createEl('input', {
            attr: { 
                type: 'checkbox',
                id: 'recursive-option',
                style: 'margin-right: 10px; width: 16px; height: 16px;',
                checked: this.useRecursive // 기본 체크 상태 설정
            }
        });
        
        recursiveOption.createEl('label', {
            text: '재귀적으로 적용 (2단계 이상 떨어진 노트에도 적용)',
            attr: { 
                for: 'recursive-option',
                style: 'font-weight: 500; cursor: pointer;' 
            }
        });
        
        // 체크박스 상태가 변경될 때 메시지 업데이트
        recursiveCheckbox.addEventListener('change', (e) => {
            this.useRecursive = (e.target as HTMLInputElement).checked;
            
            // 메시지 업데이트
            const targetDesc = this.useRecursive ? '연결된 모든 노트' : '직접 연결된 노트';
            
            // 첫 번째 메시지 요소 (주 경고 메시지)
            const messageElements = warningBox.querySelectorAll('p');
            if (messageElements.length >= 1) {
                let mainMessage = '';
                switch(option) {
                    case 'add':
                        mainMessage = `선택한 태그를 ${targetDesc}에 추가하시겠습니까?`;
                        break;
                    case 'remove':
                        mainMessage = `선택한 태그를 ${targetDesc}에서 삭제하시겠습니까?`;
                        break;
                    case 'replace':
                        mainMessage = `${targetDesc}의 태그를 선택한 태그로 변경하시겠습니까?`;
                        break;
                }
                messageElements[0].textContent = mainMessage;
            }
            
            // 두 번째 메시지 요소 (부가 경고 메시지)
            if (messageElements.length >= 2) {
                let subMessage = '';
                switch(option) {
                    case 'add':
                    case 'remove':
                        subMessage = `이 작업은 ${targetDesc}의 태그를 수정합니다.`;
                        break;
                    case 'replace':
                        subMessage = `이 작업은 ${targetDesc}의 태그를 완전히 대체합니다.`;
                        break;
                }
                messageElements[1].textContent = subMessage;
            }
        });
        
        // 버튼 컨테이너
        const buttonContainer = container.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem; margin-top: 1.5rem;' } // 2rem에서 1.5rem으로 마진 줄임
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
                        result = await updateTags.addTagsToLinkedNotes(this.file, this.selectedTags, this.useRecursive);
                        break;
                    case 'remove':
                        result = await updateTags.removeTagsFromLinkedNotes(this.file, this.selectedTags, this.useRecursive);
                        break;
                    case 'replace':
                        result = await updateTags.replaceTagsInLinkedNotes(this.file, this.selectedTags, this.useRecursive);
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