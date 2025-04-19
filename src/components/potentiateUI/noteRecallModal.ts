import { App, Modal, ButtonComponent, Notice } from 'obsidian';
import { 
    startRecording, 
    stopRecording, 
    transcribeAudio, 
    RecordingSession, 
    formatRecordingTime,
    startRealtimeSpeechRecognition,
    stopRealtimeSpeechRecognition,
    RealtimeSpeechSession
} from '../../modules/ai/ai_utils/whisperUtils';
import { checkAccuracy, AccuracyResult } from '../../modules/ai/ai_utils/accuracyChecker';
import { AILSSSettings } from '../../core/settings/settings';
import AILSSPlugin from '../../../main';

/**
 * 음성 인식 상태를 나타내는 열거형
 */
enum RecognitionState {
    IDLE = 'idle',                   // 대기 상태
    RECORDING = 'recording',         // 녹음 중
    PROCESSING = 'processing',       // 처리 중
    COMPLETED = 'completed',         // 완료됨
    ERROR = 'error'                  // 오류 발생
}

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
    private recordingStatusIcon: HTMLElement;
    
    // 녹음 관련
    private recordingSession: RecordingSession | null = null;
    private realtimeSpeechSession: RealtimeSpeechSession | null = null;
    private recordingTimer: number | null = null;
    private recordingStartTime: number = 0;
    
    // 상태 관리
    private recognitionState: RecognitionState = RecognitionState.IDLE;
    private statusClearTimer: number | null = null;
    private waitingToRestart: boolean = false;
    
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
        
        // 상태 표시 영역 (버튼 왼쪽에 배치)
        this.statusEl = buttonContainerEl.createDiv({ cls: 'note-recall-status' });
        
        // 녹음 상태 아이콘 (원형 애니메이션)
        this.recordingStatusIcon = this.statusEl.createDiv({ cls: 'recording-status-icon' });
        this.recordingStatusIcon.style.display = 'none';
        
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
        
        // 초기 상태 설정
        this.updateUIByState(RecognitionState.IDLE);
        this.addCustomStyles();
    }
    
    /**
     * 커스텀 스타일 추가 - 모달 레벨에서 추가하여 전역 스타일과 충돌 방지
     */
    private addCustomStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .note-recall-status .recording-status-icon {
                display: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background-color: #ff5d5d; /* 더 눈에 띄는 적색 */
                margin-right: 8px;
            }
            
            @keyframes recording-pulse {
                0% { transform: scale(0.85); opacity: 0.7; box-shadow: 0 0 0 0 rgba(255, 93, 93, 0.5); }
                50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 0 8px rgba(255, 93, 93, 0); }
                100% { transform: scale(0.85); opacity: 0.7; box-shadow: 0 0 0 0 rgba(255, 93, 93, 0); }
            }
            
            .note-recall-status.recording .recording-status-icon {
                display: block;
                animation: recording-pulse 1.2s infinite cubic-bezier(0.66, 0, 0.33, 1);
            }
        `;
        document.head.appendChild(styleEl);
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
            (titleEl as HTMLElement).style.textAlign = 'left';
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
            statusEl.style.minWidth = '120px';
            statusEl.style.textAlign = 'right';
            statusEl.style.fontSize = '0.9em';
            statusEl.style.color = 'var(--text-muted)';
            statusEl.style.display = 'flex';
            statusEl.style.alignItems = 'center';
            statusEl.style.justifyContent = 'flex-end';
            statusEl.style.gap = '8px';
        }
    }
    
    /**
     * 상태에 따른 UI 업데이트를 처리하는 중앙 함수
     */
    private updateUIByState(state: RecognitionState) {
        // 이전 타이머 초기화
        if (this.statusClearTimer) {
            clearTimeout(this.statusClearTimer);
            this.statusClearTimer = null;
        }
        
        this.recognitionState = state;
        
        // 상태 표시 요소 초기화
        this.statusEl.removeClass('recording');
        
        // 상태별 UI 업데이트
        switch (state) {
            case RecognitionState.IDLE:
                this.waitingToRestart = false;
                this.statusEl.setText('');
                this.micButton.setButtonText('음성 인식');
                this.micButton.buttonEl.removeClass('recording');
                this.micButton.setDisabled(false);
                this.submitButton.setDisabled(false);
                break;
                
            case RecognitionState.RECORDING:
                this.waitingToRestart = false;
                this.statusEl.setText('인식 중');
                this.statusEl.addClass('recording');
                this.micButton.setButtonText('■ 중지');
                this.micButton.buttonEl.addClass('recording');
                this.micButton.setDisabled(false);
                break;
                
            case RecognitionState.PROCESSING:
                this.statusEl.setText('처리 중...');
                this.micButton.setButtonText('음성 인식');
                this.micButton.buttonEl.removeClass('recording');
                this.micButton.setDisabled(true);
                break;
                
            case RecognitionState.COMPLETED:
                this.statusEl.setText('완료됨');
                this.micButton.setDisabled(false);
                
                // 상태 변수 설정 - IDLE로 전환될 때 인식할 수 있도록
                this.waitingToRestart = true;
                
                // 2초 후 IDLE 상태로 자동 전환
                this.statusClearTimer = window.setTimeout(() => {
                    this.updateUIByState(RecognitionState.IDLE);
                }, 2000);
                break;
                
            case RecognitionState.ERROR:
                this.statusEl.setText('오류 발생');
                this.micButton.setDisabled(false);
                
                // 2초 후 IDLE 상태로 자동 전환
                this.statusClearTimer = window.setTimeout(() => {
                    this.updateUIByState(RecognitionState.IDLE);
                }, 2000);
                break;
        }
    }
    
    /**
     * 녹음 상태 토글
     */
    async toggleRecording() {
        // 현재 대기 중이거나 방금 완료된 경우 녹음 시작
        if (this.recognitionState === RecognitionState.IDLE || this.waitingToRestart) {
            await this.startRealtimeSpeechRecognition();
        } 
        // 녹음 중인 경우 녹음 중지
        else if (this.recognitionState === RecognitionState.RECORDING) {
            await this.stopRealtimeSpeechRecognition();
        }
    }
    
    /**
     * 실시간 음성 인식 시작
     */
    async startRealtimeSpeechRecognition() {
        try {
            // API 키 확인
            const apiKey = this.settings.openAIAPIKey;
            if (!apiKey) {
                new Notice('OpenAI API 키가 설정되지 않았습니다.');
                return;
            }
            
            // 상태 업데이트
            this.updateUIByState(RecognitionState.RECORDING);
            this.recordingStartTime = Date.now();
            
            // 기존 텍스트 저장 (이어서 녹음 옵션)
            const existingText = this.inputEl.value;
            
            // 이상한 텍스트 방지를 위해 녹음 시작 전에 초기화 진행
            if (this.waitingToRestart) {
                // 새 녹음 시작 전에 입력창 비우고 시작할지 물어봄
                new Notice('새 녹음을 시작합니다. 이전 텍스트에 이어서 녹음합니다.');
            }
            
            // 실시간 음성 인식 시작 (3초마다 청크 처리)
            this.realtimeSpeechSession = await startRealtimeSpeechRecognition(
                3000, // 3초마다 음성 데이터 처리
                apiKey,
                (text, isFinal) => {
                    // 텍스트 변환 결과를 입력창에 표시 (기존 텍스트 유지)
                    if (existingText) {
                        this.inputEl.value = existingText + ' ' + text;
                    } else {
                        this.inputEl.value = text;
                    }
                }
            );
            
            // 타이머 시작
            this.recordingTimer = window.setInterval(() => {
                const elapsed = Date.now() - this.recordingStartTime;
                this.recordingTimerEl.setText(formatRecordingTime(elapsed));
            }, 1000);
            
        } catch (error) {
            console.error('실시간 음성 인식 시작 오류:', error);
            new Notice('마이크 접근에 실패했습니다. 브라우저 권한을 확인해주세요.');
            this.updateUIByState(RecognitionState.ERROR);
        }
    }
    
    /**
     * 실시간 음성 인식 중지
     */
    async stopRealtimeSpeechRecognition() {
        if (!this.realtimeSpeechSession) return;
        
        try {
            // 타이머 중지
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
            
            // 상태 업데이트
            this.updateUIByState(RecognitionState.PROCESSING);
            
            // 실시간 음성 인식 중지
            const finalText = await stopRealtimeSpeechRecognition(this.realtimeSpeechSession);
            this.realtimeSpeechSession = null;
            
            // 완료 상태로 업데이트
            this.updateUIByState(RecognitionState.COMPLETED);
            this.recordingTimerEl.setText('');
            
        } catch (error) {
            console.error('실시간 음성 인식 중지 오류:', error);
            new Notice('음성 인식 처리 중 오류가 발생했습니다.');
            this.updateUIByState(RecognitionState.ERROR);
            this.recordingTimerEl.setText('');
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
            this.micButton.setDisabled(true);
            this.updateUIByState(RecognitionState.PROCESSING);
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
            this.updateUIByState(RecognitionState.ERROR);
            this.submitButton.setDisabled(false);
            this.micButton.setDisabled(false);
            this.isProcessing = false;
        }
    }
    
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        // 실시간 음성 인식 중이라면 중지
        if (this.realtimeSpeechSession && this.realtimeSpeechSession.isRecording) {
            this.realtimeSpeechSession.recorder.stop();
            if (this.realtimeSpeechSession.recorder.stream) {
                this.realtimeSpeechSession.recorder.stream.getTracks().forEach(track => track.stop());
            }
        }
        
        // 타이머가 실행 중이라면 중지
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        
        // 상태 타이머가 실행 중이라면 중지
        if (this.statusClearTimer) {
            clearTimeout(this.statusClearTimer);
            this.statusClearTimer = null;
        }
    }
} 