import { Notice } from 'obsidian';

/**
 * Whisper API 응답 타입 정의
 */
export interface WhisperTranscriptionResult {
    text: string;
    confidence?: number;
}

/**
 * 녹음 상태 관리를 위한 인터페이스
 */
export interface RecordingSession {
    recorder: MediaRecorder;
    chunks: Blob[];
    isRecording: boolean;
    startTime: number;
}

/**
 * 오디오 녹음을 시작하고 녹음 세션을 반환합니다.
 * @returns RecordingSession 녹음 세션 객체
 */
export async function startRecording(): Promise<RecordingSession> {
    try {
        // 마이크 접근 권한 요청
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // MediaRecorder 설정
        const recorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm',
        });
        
        const chunks: Blob[] = [];
        
        // 데이터 수집
        recorder.addEventListener('dataavailable', (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        });
        
        // 녹음 시작
        recorder.start();
        
        // 녹음 세션 반환
        return {
            recorder,
            chunks,
            isRecording: true,
            startTime: Date.now()
        };
    } catch (error) {
        console.error('마이크 접근 오류:', error);
        new Notice('마이크 접근에 실패했습니다. 마이크 권한을 확인해주세요.');
        throw error;
    }
}

/**
 * 녹음을 중지하고 오디오 데이터를 반환합니다.
 * @param session 녹음 세션 객체
 * @returns Promise<Blob> 오디오 데이터
 */
export function stopRecording(session: RecordingSession): Promise<Blob> {
    return new Promise((resolve) => {
        session.recorder.addEventListener('stop', () => {
            // 모든 청크를 하나의 Blob으로 병합
            const audioBlob = new Blob(session.chunks, { type: 'audio/webm' });
            
            // 사용 완료된 미디어 스트림 트랙 중지
            session.recorder.stream.getTracks().forEach(track => track.stop());
            
            resolve(audioBlob);
        });
        
        // 녹음 중지
        if (session.isRecording) {
            session.recorder.stop();
            session.isRecording = false;
        }
    });
}

/**
 * Whisper API를 사용하여 오디오를 텍스트로 변환합니다.
 * @param audioBlob 오디오 데이터
 * @param apiKey OpenAI API 키
 * @returns Promise<WhisperTranscriptionResult> 변환 결과
 */
export async function transcribeAudio(
    audioBlob: Blob,
    apiKey: string
): Promise<WhisperTranscriptionResult> {
    try {
        // 25MB 크기 제한 확인
        if (audioBlob.size > 25 * 1024 * 1024) {
            throw new Error('오디오 파일이 25MB를 초과합니다.');
        }

        // FormData 구성
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('language', 'ko'); // 한국어로 설정

        // API 요청
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Whisper API 오류: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return {
            text: data.text,
            confidence: data.confidence || undefined,
        };
    } catch (error) {
        console.error('음성 변환 오류:', error);
        new Notice('음성을 텍스트로 변환하는 중 오류가 발생했습니다.');
        throw error;
    }
}

/**
 * 네트워크 연결 상태를 확인합니다.
 * @returns boolean 네트워크 연결 상태
 */
export function isOnline(): boolean {
    return navigator.onLine;
}

/**
 * 오디오 녹음 시간을 포맷팅합니다.
 * @param milliseconds 밀리초 단위 시간
 * @returns string 포맷팅된 시간 문자열 (MM:SS)
 */
export function formatRecordingTime(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
} 