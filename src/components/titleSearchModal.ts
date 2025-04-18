import { App, Modal, TFile, setIcon } from 'obsidian';

interface TitleSearchModalOptions {
    title: string;
    message: string;
    searchResults: {
        file: TFile;
        title: string;
        matchType: 'title' | 'alias' | 'both';
    }[];
    onSelect: (file: TFile) => void;
    onCreateNew: () => void;
    onCancel: () => void;
}

/**
 * 노트 생성 전 비슷한 제목을 가진 노트를 확인하는 모달
 */
export class TitleSearchModal extends Modal {
    private options: TitleSearchModalOptions;

    constructor(app: App, options: TitleSearchModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen() {
        const { contentEl } = this;
        
        const container = contentEl.createDiv({
            cls: "title-search-modal-container",
            attr: { style: "padding: 2rem;" }
        });

        // 헤더
        container.createEl('h2', { 
            text: this.options.title,
            attr: { style: "margin: 0 0 1rem 0; font-size: 1.5em; text-align: center;" }
        });

        // 안내 메시지
        const messageBox = container.createDiv({
            attr: { 
                style: "background-color: var(--background-secondary); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;" 
            }
        });
        
        messageBox.createEl('p', { 
            text: this.options.message,
            attr: { style: "margin: 0; text-align: center;" } 
        });

        // 검색 결과 컨테이너
        const resultsContainer = container.createDiv({
            attr: {
                style: "max-height: 300px; overflow-y: auto; margin-bottom: 1.5rem;"
            }
        });

        if (this.options.searchResults.length > 0) {
            resultsContainer.createEl('h3', {
                text: "유사한 노트",
                attr: { style: "margin: 0 0 1rem 0; font-size: 1.1em;" }
            });

            // 검색 결과 표시
            this.options.searchResults.forEach(result => {
                const resultCard = resultsContainer.createEl('div', {
                    cls: 'search-result-card',
                    attr: { 
                        style: 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-secondary); transition: all 0.2s ease; cursor: pointer;' 
                    }
                });
                
                // 호버 효과
                resultCard.addEventListener('mouseenter', () => {
                    resultCard.setAttribute('style', 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-modifier-hover); transition: all 0.2s ease; cursor: pointer;');
                });
                
                resultCard.addEventListener('mouseleave', () => {
                    resultCard.setAttribute('style', 'padding: 0.8rem; margin-bottom: 0.8rem; border-radius: 4px; background-color: var(--background-secondary); transition: all 0.2s ease; cursor: pointer;');
                });

                // 제목과 정보 컨테이너
                const infoContainer = resultCard.createDiv({
                    attr: { style: "display: flex; justify-content: space-between; align-items: center;" }
                });
                
                // 제목 및 정보 그룹
                const titleGroup = infoContainer.createDiv({
                    attr: { style: "flex: 1;" }
                });

                // 매치 타입에 따른 아이콘 및 툴팁 추가
                const titleWithIcon = titleGroup.createDiv({
                    attr: { style: "display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem;" }
                });

                // 제목
                titleWithIcon.createEl('div', {
                    text: result.title,
                    attr: { style: "font-weight: 600; overflow: hidden; text-overflow: ellipsis;" }
                });

                // 매치 타입에 따른 라벨
                const matchBadge = titleWithIcon.createEl('span', {
                    attr: { 
                        style: "font-size: 0.7em; padding: 0.1rem 0.4rem; border-radius: 4px; background-color: var(--interactive-accent); color: var(--text-on-accent);" 
                    }
                });

                if (result.matchType === 'title') {
                    matchBadge.innerText = '제목 일치';
                } else if (result.matchType === 'alias') {
                    matchBadge.innerText = '별칭 일치';
                } else {
                    matchBadge.innerText = '제목/별칭 일치';
                }

                // 파일 경로 표시
                titleGroup.createEl('div', {
                    text: result.file.path,
                    attr: { style: "font-size: 0.8em; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis;" }
                });
                
                // 선택 버튼
                const selectButton = infoContainer.createEl('button', {
                    text: '사용',
                    cls: 'mod-cta',
                    attr: { style: "margin-left: 0.5rem; padding: 0.3rem 0.8rem; border-radius: 4px;" }
                });
                
                // 선택 이벤트
                selectButton.addEventListener('click', () => {
                    this.close();
                    this.options.onSelect(result.file);
                });

                // 전체 카드 클릭 시 선택하도록
                resultCard.addEventListener('click', (e) => {
                    // 버튼 클릭은 제외
                    if (e.target !== selectButton && !selectButton.contains(e.target as Node)) {
                        this.close();
                        this.options.onSelect(result.file);
                    }
                });
            });
        } else {
            // 검색 결과가 없는 경우
            resultsContainer.createEl('p', {
                text: "일치하는 노트를 찾을 수 없습니다.",
                attr: { style: "text-align: center; color: var(--text-muted); padding: 1rem 0;" }
            });
        }

        // 버튼 컨테이너
        const buttonsContainer = container.createDiv({
            attr: {
                style: "display: flex; justify-content: space-between; gap: 1rem;"
            }
        });

        // 새 노트 생성 버튼
        const createNewButton = buttonsContainer.createEl('button', {
            cls: "mod-cta",
            attr: { style: "padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;" }
        });
        
        // 버튼 내용
        const createBtnContent = createNewButton.createDiv({
            attr: { style: "display: flex; align-items: center; justify-content: center; gap: 0.5rem;" }
        });
        
        // 아이콘 추가
        const createIconContainer = createBtnContent.createSpan();
        setIcon(createIconContainer, 'file-plus');
        
        createBtnContent.createSpan({ text: '새 노트 생성' });
        
        // 취소 버튼
        const cancelButton = buttonsContainer.createEl('button', {
            text: "취소",
            attr: { style: "padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;" }
        });

        // 이벤트 리스너
        createNewButton.addEventListener('click', () => {
            this.close();
            this.options.onCreateNew();
        });

        cancelButton.addEventListener('click', () => {
            this.close();
            this.options.onCancel();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * 노트 생성 전 비슷한 제목을 확인하는 모달을 표시합니다
 */
export async function showTitleSearchModal(
    app: App, 
    options: Omit<TitleSearchModalOptions, 'onSelect' | 'onCreateNew' | 'onCancel'>
): Promise<{action: 'select' | 'create' | 'cancel', selectedFile?: TFile}> {
    return new Promise(resolve => {
        const modal = new TitleSearchModal(app, {
            ...options,
            onSelect: (file: TFile) => {
                resolve({action: 'select', selectedFile: file});
            },
            onCreateNew: () => {
                resolve({action: 'create'});
            },
            onCancel: () => {
                resolve({action: 'cancel'});
            }
        });
        
        modal.open();
    });
}