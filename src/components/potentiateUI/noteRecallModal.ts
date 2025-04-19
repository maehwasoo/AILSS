import { App, Modal, Setting, ButtonComponent, MarkdownRenderer, Notice } from 'obsidian';
import { startRecording, stopRecording, transcribeAudio, RecordingSession, formatRecordingTime } from '../../modules/ai/ai_utils/whisperUtils';
import { checkAccuracy, AccuracyResult } from '../../modules/ai/ai_utils/accuracyChecker';
import { AILSSSettings } from '../../core/settings/settings';

/**
 * 노트 복기 모달 UI
 * 사용자가 노트 내용을 복기하여 입력하거나 음성으로 녹음할 수 있는 모달
 */
export class NoteRecallModal extends Modal {
    private noteContent: string;
    private onAccuracyResult: (result: AccuracyResult) => void;
    private settings: AILSSSettings;
    
    // UI 요소
    private inputEl: HTMLTextAreaElement;
    private micButton: ButtonComponent;
    private submitButton: ButtonComponent;
    private statusEl: HTMLElement;
    private recordingTimerEl: HTMLElement;
    
    // 녹음 관련
    private recordingSession: RecordingSession | null = null;
    private recordingTimer: number | null = null;
    private recordingStartTime: number = 0;
    
    // 분석 상태
    private isProcessing: boolean = false;
    
    constructor(
        app: App, 
        noteContent: string, 
        settings: AILSSSettings,
        onAccuracyResult: (result: AccuracyResult) => void
    ) {
        super(app);
        this.noteContent = noteContent;
        this.settings = settings;
        this.onAccuracyResult = onAccuracyResult;
    }
    
    onOpen() {
        const { contentEl } = this;
        
        // 모달 제목
        contentEl.createEl('h2', { text: '노트 복기', cls: 'note-recall-title' });
        
        // 안내 텍스트
        const instructionsEl = contentEl.createEl('p', { 
            text: '이 노트의 내용을 기억나는 대로 작성하거나 음성으로 말해보세요. 정확도가 75% 이상이어야 강화가 적용됩니다.',
            cls: 'note-recall-instructions'
        });
        
        // 입력 영역
        const inputContainerEl = contentEl.createDiv({ cls: 'note-recall-input-container' });
        this.inputEl = inputContainerEl.createEl('textarea', {
            attr: { 
                placeholder: '노트 내용을 기억나는 대로 입력하거나 마이크 버튼을 눌러 말하세요...',
                rows: '10'
            },
            cls: 'note-recall-textarea'
        });
        
        // 상태 표시 영역
        this.statusEl = contentEl.createDiv({ cls: 'note-recall-status' });
        this.recordingTimerEl = this.statusEl.createEl('span', { 
            text: '',
            cls: 'note-recall-timer'
        });
        
        // 버튼 컨테이너
        const buttonContainerEl = contentEl.createDiv({ cls: 'note-recall-button-container' });
        
        // 마이크 버튼
        this.micButton = new ButtonComponent(buttonContainerEl)
            .setButtonText('🎤 녹음')
            .setClass('note-recall-mic-button')
            .onClick(() => this.toggleRecording());
        
        // 제출 버튼
        this.submitButton = new ButtonComponent(buttonContainerEl)
            .setButtonText('제출')
            .setClass('note-recall-submit-button')
            .onClick(() => this.submitRecall());
        
        // 취소 버튼
        new ButtonComponent(buttonContainerEl)
            .setButtonText('취소')
            .setClass('note-recall-cancel-button')
            .onClick(() => this.close());
        
        // CSS 스타일 적용
        this.applyStyles();
    }
    
    /**
     * 모달에 스타일 적용
     */
    private applyStyles() {
        const { contentEl } = this;
        
        // 타이틀 스타일
        contentEl.querySelector('.note-recall-title').addClass('title-text');
        
        // 입력 영역 스타일
        contentEl.querySelector('.note-recall-textarea').style.width = '100%';
        contentEl.querySelector('.note-recall-textarea').style.minHeight = '150px';
        contentEl.querySelector('.note-recall-textarea').style.resize = 'vertical';
        contentEl.querySelector('.note-recall-textarea').style.marginBottom = '1rem';
        
        // 버튼 컨테이너 스타일
        contentEl.querySelector('.note-recall-button-container').style.display = 'flex';
        contentEl.querySelector('.note-recall-button-container').style.justifyContent = 'flex-end';
        contentEl.querySelector('.note-recall-button-container').style.gap = '0.5rem';
        
        // 마이크 버튼 스타일
        contentEl.querySelector('.note-recall-mic-button').addClass('mod-warning');
        
        // 제출 버튼 스타일
        contentEl.querySelector('.note-recall-submit-button').addClass('mod-cta');
    }
    
    /**
     * 녹음 상태 토글
     */
    async toggleRecording() {
        if (this.recordingSession && this.recordingSession.isRecording) {
            await this.stopRecordingAndTranscribe();
        } else {
            await this.startRecordingAudio();
        }
    }
    
    /**
     * 오디오 녹음 시작
     */
    async startRecordingAudio() {
        try {
            // 녹음 시작
            this.recordingSession = await startRecording();
            this.recordingStartTime = Date.now();
            
            // UI 업데이트
            this.micButton.setButtonText('■ 중지');
            this.micButton.buttonEl.addClass('recording');
            this.statusEl.setText('녹음 중...');
            
            // 타이머 시작
            this.recordingTimer = window.setInterval(() => {
                const elapsed = Date.now() - this.recordingStartTime;
                this.recordingTimerEl.setText(formatRecordingTime(elapsed));
            }, 1000);
            
        } catch (error) {
            console.error('녹음 시작 오류:', error);
            new Notice('마이크 접근에 실패했습니다. 브라우저 권한을 확인해주세요.');
        }
    }
    
    /**
     * 녹음 중지 및 텍스트 변환
     */
    async stopRecordingAndTranscribe() {
        if (!this.recordingSession) return;
        
        try {
            // 타이머 중지
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
            
            // UI 업데이트
            this.micButton.setButtonText('🎤 녹음');
            this.micButton.buttonEl.removeClass('recording');
            this.statusEl.setText('변환 중...');
            
            // 녹음 중지 및 오디오 데이터 가져오기
            const audioBlob = await stopRecording(this.recordingSession);
            this.recordingSession = null;
            
            // API 키 확인
            const apiKey = this.settings.openAIAPIKey;
            if (!apiKey) {
                new Notice('OpenAI API 키가 설정되지 않았습니다.');
                this.statusEl.setText('');
                return;
            }
            
            // 오디오를 텍스트로 변환
            const result = await transcribeAudio(audioBlob, apiKey);
            
            // 변환된 텍스트를 입력창에 표시
            this.inputEl.value = result.text;
            this.statusEl.setText('변환 완료');
            
            // 3초 후 상태 메시지 제거
            setTimeout(() => {
                if (this.statusEl.getText() === '변환 완료') {
                    this.statusEl.setText('');
                }
            }, 3000);
            
        } catch (error) {
            console.error('녹음 처리 오류:', error);
            new Notice('오디오 처리 중 오류가 발생했습니다.');
            this.statusEl.setText('');
        }
    }
    
    /**
     * 노트 복기 제출 및 정확도 검증
     */
    async submitRecall() {
        const userInput = this.inputEl.value.trim();
        
        if (!userInput) {
            new Notice('내용을 입력하거나 녹음해주세요.');
            return;
        }
        
        if (this.isProcessing) {
            return;
        }
        
        try {
            this.isProcessing = true;
            this.submitButton.setDisabled(true);
            this.statusEl.setText('정확도 분석 중...');
            
            // 정확도 검증 수행
            const result = await checkAccuracy(
                this.noteContent,
                userInput,
                this.settings
            );
            
            // 결과 전달 및 모달 닫기
            this.onAccuracyResult(result);
            this.close();
            
        } catch (error) {
            console.error('정확도 검증 오류:', error);
            new Notice('정확도 검증 중 오류가 발생했습니다.');
            this.statusEl.setText('');
            this.submitButton.setDisabled(false);
            this.isProcessing = false;
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 녹음 중이라면 중지
        if (this.recordingSession && this.recordingSession.isRecording) {
            this.recordingSession.recorder.stop();
            if (this.recordingSession.recorder.stream) {
                this.recordingSession.recorder.stream.getTracks().forEach(track => track.stop());
            }
        }
        
        // 타이머가 실행 중이라면 중지
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }
} 