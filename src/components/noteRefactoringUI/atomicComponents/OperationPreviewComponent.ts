import { TFile } from 'obsidian';
import { RefactoringComponentProps } from './types';
import { FrontmatterManager } from '../../../core/utils/frontmatterManager';

/**
 * 작업 미리보기 컴포넌트
 */
export class OperationPreviewComponent {
    private props: RefactoringComponentProps;
    private onBack: () => void;
    private onExecute: () => void;
    private selectedNotes: TFile[];
    
    constructor(
        props: RefactoringComponentProps, 
        onBack: () => void,
        onExecute: () => void,
        selectedNotes: TFile[]
    ) {
        this.props = props;
        this.onBack = onBack;
        this.onExecute = onExecute;
        this.selectedNotes = selectedNotes;
    }
    
    /**
     * 작업 미리보기 UI 렌더링
     */
    async render(): Promise<void> {
        const { stepContainer, selectedOption, fileTitle } = this.props;
        stepContainer.empty();
        
        const previewContainer = stepContainer.createDiv({ cls: 'note-preview' });
        
        // 헤더
        const operationTitle = selectedOption === 'merge' ? '노트 통합' : '노트 조정';
        previewContainer.createEl('h3', { 
            text: operationTitle,
            attr: { style: 'margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;' }
        });
        
        // 작업 정보 카드
        const operationInfoCard = previewContainer.createDiv({
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
            text: fileTitle,
            attr: { style: 'font-weight: 600;' } 
        });
        
        currentNoteItem.createSpan({ 
            text: ' (현재 노트)',
            attr: { style: 'color: var(--text-muted);' } 
        });
        
        // 선택된 다른 노트들 (frontmatter title 표시)
        for (const file of this.selectedNotes) {
            const content = await this.props.app.vault.cachedRead(file);
            const fm = new FrontmatterManager().parseFrontmatter(content);
            const fmTitle = fm?.title || file.basename;
            notesList.createEl('li', { text: fmTitle });
        }
        
        // 작업 설명
        if (selectedOption === 'merge') {
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
        const warningBox = previewContainer.createDiv({
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
        const buttonContainer = previewContainer.createDiv({
            attr: { style: 'display: flex; justify-content: space-between; gap: 1rem;' }
        });
        
        // 이전 버튼
        const backButton = buttonContainer.createEl('button', {
            text: '이전',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 실행 버튼
        const executeButton = buttonContainer.createEl('button', {
            text: selectedOption === 'merge' ? '통합 실행' : '조정 실행',
            cls: 'mod-cta',
            attr: { style: 'padding: 0.6rem 1.2rem; flex: 1; border-radius: 4px;' }
        });
        
        // 이벤트 리스너
        backButton.addEventListener('click', () => this.onBack());
        executeButton.addEventListener('click', () => this.onExecute());
    }
}
