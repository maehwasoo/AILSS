import { setIcon } from 'obsidian';
import { RefactoringComponentProps, RefactoringOption } from './types';

/**
 * 노트 리팩토링 옵션 선택 UI 컴포넌트
 */
export class OptionSelectionComponent {
    private props: RefactoringComponentProps;
    private onOptionSelected: (option: RefactoringOption) => void;

    constructor(props: RefactoringComponentProps, onOptionSelected: (option: RefactoringOption) => void) {
        this.props = props;
        this.onOptionSelected = onOptionSelected;
    }

    /**
     * 옵션 선택 UI 렌더링
     */
    render(): void {
        const { stepContainer } = this.props;
        stepContainer.empty();
        
        // 제목
        stepContainer.createEl('h3', { 
            text: '리팩토링 옵션',
            attr: { style: "margin: 0 0 1.5rem 0; font-size: 1.2em; text-align: center; font-weight: 600;" }
        });
        
        // 옵션 버튼 컨테이너 - 가로 배치
        const optionsContainer = stepContainer.createDiv({
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
        const descriptionContainer = stepContainer.createDiv({ 
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
    
    /**
     * 옵션 설명 카드 생성
     */
    private createOptionDescription(container: HTMLElement, title: string, description: string): void {
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
    
    /**
     * 옵션 버튼 생성
     */
    private createOptionButton(container: HTMLElement, option: RefactoringOption, text: string, iconName: string): void {
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
            this.onOptionSelected(option);
        });
    }
}
