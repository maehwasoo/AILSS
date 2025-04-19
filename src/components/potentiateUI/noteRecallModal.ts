import { App, Modal, Setting, ButtonComponent, MarkdownRenderer, Notice } from 'obsidian';
import { startRecording, stopRecording, transcribeAudio, RecordingSession, formatRecordingTime } from '../../modules/ai/ai_utils/whisperUtils';
import { checkAccuracy, AccuracyResult } from '../../modules/ai/ai_utils/accuracyChecker';
import { AILSSSettings } from '../../core/settings/settings';
import AILSSPlugin from '../../../main';

/**
 * 노트 복기 모달 UI
 * 사용자가 노트 내용을 복기하여 입력하거나 음성으로 녹음할 수 있는 모달
 */
export class NoteRecallModal extends Modal {
    private noteContent: string;
    private onAccuracyResult: (result: AccuracyResult) => void;
    private settings: AILSSSettings;
    private plugin: AILSSPlugin;
    
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
        plugin: AILSSPlugin,
        onAccuracyResult: (result: AccuracyResult) => void
    ) {
        super(app);
        this.noteContent = noteContent;
        this.settings = settings;
        this.plugin = plugin;
        this.onAccuracyResult = onAccuracyResult;
    }
    
    onOpen() {
        const { contentEl } = this;
        
        // 모달 컨텐츠 영역 패딩 추가
        contentEl.style.padding = '1rem';
        
        // 헤더 컨테이너 (제목과 버튼을 같은 줄에 배치)
        const headerContainerEl = contentEl.createDiv({ cls: 'note-recall-header-container' });
        
        // 모달 제목 (좌측 배치)
        headerContainerEl.createEl('h2', { text: '노트 복기', cls: 'note-recall-title' });
        
        // 버튼 컨테이너 (우측 배치)
        const buttonContainerEl = headerContainerEl.createDiv({ cls: 'note-recall-button-container' });
        
        // 상태 표시 영역 - 이동됨 (버튼 왼쪽에 배치)
        this.statusEl = buttonContainerEl.createDiv({ cls: 'note-recall-status' });
        this.recordingTimerEl = this.statusEl.createEl('span', { 
            text: '',
            cls: 'note-recall-timer'
        });
        
        // 마이크 버튼
        this.micButton = new ButtonComponent(buttonContainerEl)
            .setButtonText('음성 인식')
            .setClass('note-recall-mic-button')
            .onClick(() => this.toggleRecording());
        
        // 제출 버튼
        this.submitButton = new ButtonComponent(buttonContainerEl)
            .setButtonText('제출')
            .setClass('note-recall-submit-button')
            .onClick(() => this.submitRecall());
        
        // 입력 영역
        const inputContainerEl = contentEl.createDiv({ cls: 'note-recall-input-container' });
        this.inputEl = inputContainerEl.createEl('textarea', {
            attr: { 
                placeholder: '노트 내용을 기억나는 대로 입력하거나 마이크 버튼을 눌러 말하세요...',
                rows: '25'
            },
            cls: 'note-recall-textarea'
        });
        
        // CSS 스타일 적용
        this.applyStyles();
    }
    
    /**
     * 모달에 스타일 적용
     */
    private applyStyles() {
        const { contentEl } = this;
        
        // 헤더 컨테이너 스타일
        const headerContainerEl = contentEl.querySelector('.note-recall-header-container') as HTMLElement;
        if (headerContainerEl) {
            headerContainerEl.style.display = 'flex';
            headerContainerEl.style.justifyContent = 'space-between';
            headerContainerEl.style.alignItems = 'center';
            headerContainerEl.style.marginBottom = '1rem';
        }
        
        // 타이틀 스타일
        const titleEl = contentEl.querySelector('.note-recall-title');
        if (titleEl) {
            (titleEl as HTMLElement).addClass('title-text');
            (titleEl as HTMLElement).style.margin = '0';
        }
        
        // 버튼 컨테이너 스타일
        const buttonContainerEl = contentEl.querySelector('.note-recall-button-container') as HTMLElement;
        if (buttonContainerEl) {
            buttonContainerEl.style.display = 'flex';
            buttonContainerEl.style.justifyContent = 'flex-end';
            buttonContainerEl.style.gap = '0.5rem';
            buttonContainerEl.style.alignItems = 'center';
        }
        
        // 입력 영역 스타일
        const textareaEl = contentEl.querySelector('.note-recall-textarea') as HTMLTextAreaElement;
        if (textareaEl) {
            textareaEl.style.width = '100%';
            textareaEl.style.minHeight = '250px';
            textareaEl.style.resize = 'vertical';
        }
        
        // 입력 컨테이너 스타일
        const inputContainerEl = contentEl.querySelector('.note-recall-input-container') as HTMLElement;
        if (inputContainerEl) {
            inputContainerEl.style.marginBottom = '1rem';
            inputContainerEl.style.height = 'auto';
        }
        
        // 마이크 버튼 스타일
        const micButtonEl = contentEl.querySelector('.note-recall-mic-button');
        if (micButtonEl) {
            (micButtonEl as HTMLElement).addClass('mod-warning');
        }
        
        // 제출 버튼 스타일
        const submitButtonEl = contentEl.querySelector('.note-recall-submit-button');
        if (submitButtonEl) {
            (submitButtonEl as HTMLElement).addClass('mod-cta');
        }
        
        // 상태 텍스트 스타일
        const statusEl = contentEl.querySelector('.note-recall-status') as HTMLElement;
        if (statusEl) {
            statusEl.style.marginRight = '0.5rem';
            statusEl.style.minWidth = '80px';
            statusEl.style.textAlign = 'right';
            statusEl.style.fontSize = '0.9em';
            statusEl.style.color = 'var(--text-muted)';
        }
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
            this.micButton.setButtonText('음성 인식');
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
            
            // 정확도 검증 수행 - plugin 객체 전달
            const result = await checkAccuracy(
                this.noteContent,
                userInput,
                this.settings,
                this.plugin
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