import { App, Modal } from 'obsidian';
import { AccuracyResult } from '../../modules/ai/ai_utils/accuracyChecker';

/**
 * 정확도 결과를 표시하는 모달
 */
export class AccuracyResultModal extends Modal {
    private result: AccuracyResult;
    private potentiationIndex: number;
    private threshold: number;
    
    constructor(app: App, result: AccuracyResult, potentiationIndex: number, threshold: number) {
        super(app);
        this.result = result;
        this.potentiationIndex = potentiationIndex;
        this.threshold = threshold;
        
        // 모달 컨텐츠 중앙 정렬 및 패딩 설정
        this.contentEl.style.textAlign = 'center';
        this.contentEl.style.padding = '20px';
    }
    
    onOpen() {
        const { contentEl } = this;
        
        // 아이콘과 색상 설정 (강화 성공 여부에 따른 컬러)
        const iconName = this.result.success ? 'check-circle' : 'alert-circle';
        const themeColor = this.result.success ? 'var(--color-green)' : 'var(--color-red)';
        
        // 결과 제목 생성
        const titleEl = contentEl.createEl('h1', { 
            text: this.result.success ? '정확도 검증 성공!' : '정확도 검증 실패', 
            cls: 'accuracy-result-title'
        });
        titleEl.style.color = themeColor;
        titleEl.style.marginBottom = '25px';
        titleEl.style.marginTop= '0px';
        
        // 점수 표시
        const scoreContainer = contentEl.createDiv({ cls: 'accuracy-score-container' });
        const scoreCircle = scoreContainer.createDiv({ cls: 'accuracy-score-circle' });
        
        // 원형 점수 표시 스타일링
        scoreCircle.style.width = '100px';
        scoreCircle.style.height = '100px';
        scoreCircle.style.borderRadius = '50%';
        scoreCircle.style.display = 'flex';
        scoreCircle.style.justifyContent = 'center';
        scoreCircle.style.alignItems = 'center';
        scoreCircle.style.margin = '0 auto 20px auto';
        scoreCircle.style.fontSize = '1.8em';
        scoreCircle.style.fontWeight = 'bold';
        
        // 결과에 따른 색상 변경 (강화 성공 여부에 따른 컬러)
        const bgColor = this.result.success ? 'rgba(0, 180, 0, 0.15)' : 'rgba(255, 0, 0, 0.15)';
        scoreCircle.style.backgroundColor = bgColor;
        scoreCircle.style.color = themeColor;
        
        // 점수 표시
        scoreCircle.setText(`${Math.round(this.result.score)}%`);
        
        // 결과 메시지
        const messageEl = contentEl.createEl('p', { 
            cls: 'accuracy-result-message'
        });

        // HTML을 사용하여 줄바꿈 적용
        messageEl.innerHTML = this.result.success
            ? `축하합니다! 강화가 성공했습니다.<br>현재 강화 지수: ${this.potentiationIndex} (임계값: ${this.threshold}%)`
            : `아쉽습니다. 강화가 실패했습니다.<br>현재 강화 지수: ${this.potentiationIndex} (임계값: ${this.threshold}% 미달)<br>정확도: ${Math.round(this.result.score)}%`;
        messageEl.style.color = themeColor;
        messageEl.style.textAlign = 'center';
        
        // 피드백 표시 (있는 경우에만)
        if (this.result.feedback) {
            const feedbackContainer = contentEl.createDiv({ cls: 'accuracy-feedback-container' });
            feedbackContainer.style.backgroundColor = 'var(--background-secondary)';
            feedbackContainer.style.padding = '15px';
            feedbackContainer.style.borderRadius = '4px';
            feedbackContainer.style.marginTop = '20px';
            
            const feedbackEl = feedbackContainer.createEl('p', { 
                text: this.result.feedback,
                cls: 'accuracy-feedback'
            });
            feedbackEl.style.textAlign = 'center';
            feedbackEl.style.margin = '0';
            feedbackEl.style.lineHeight = '1.8';
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
