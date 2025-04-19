# 포텐시에이트 모듈 개선 계획

## 개요 및 목표

포텐시에이트(Potentiate) 모듈은 노트의 강화 값(potentiation)을 관리하는 기능으로, 현재는 명령어 실행 시 단순히 강화 값을 +1 증가시키는 기능만 제공합니다. 이 모듈을 개선하여 다음 기능을 추가하고자 합니다:

- [ ] 1. 노트 내용 복기를 통한 정확도 검증 기능
- [ ] 2. 텍스트 또는 음성 입력 방식 지원
- [ ] 3. AI를 통한 정확도 평가(75% 이상일 때만 강화 적용)

이 모든 기능은 유지보수가 쉽고, 사용자 설정을 통해 켜고 끌 수 있도록 모듈화하며, 기존 컴포넌트를 최대한 재활용하여 일관성을 유지합니다.

## 1. 모듈 구조 재구성

### 1.1 디렉토리 구조

```
src/
├── modules/
│   ├── command/
│   │   └── update/
│   │       └── potentiate.ts        # 기존 파일 리팩토링 (핵심 로직 유지)
│   │
│   └── ai/
│       └── ai_utils/
│           ├── aiUtils.ts           # 기존 AI 유틸리티 재활용
│           ├── whisperUtils.ts      # 음성 인식 기능 (신규)
│           └── accuracyChecker.ts   # 정확도 평가 서비스 (신규)
│
├── components/
│   └── potentiateUI/
│       └── noteRecallModal.ts       # 노트 복기 모달 UI
│
└── core/
    └── settings/
        └── settings.ts              # 정확도 검증 토글 추가
```

### 1.2 기존 코드 이전 및 확장

- [ ] `potentiate.ts`의 핵심 강화 로직은 그대로 유지
- [ ] 노트 복기 및 정확도 검증 기능을 위한 인터페이스 추가
- [ ] 설정을 통해 정확도 검증 기능을 On/Off할 수 있도록 구현

## 2. 기능 구현 계획

### 2.1 노트 복기 기능

#### 기존 로직
- [x] 노트에서 명령어 실행 → 확인 모달 → 강화 값(potentiation) +1 증가

#### 개선 로직
- [ ] 노트에서 명령어 실행 → 설정 확인 → (검증 활성화 시) 노트 복기 모달 → 정확도 검증 → 결과에 따른 강화 적용
- [ ] 정확도 75% 이상 시에만 강화 값 +1 적용
- [ ] 검증 비활성화 시 기존 로직대로 바로 강화 적용

### 2.2 정확도 검증 서비스 (accuracyChecker.ts)

- [ ] 노트 내용과 사용자 입력을 비교하여 정확도 평가
- [ ] `settings.ts`에 설정된 AI 모델(Claude, OpenAI 등) 활용
- [ ] 정확도 계산 알고리즘: AI 모델에 두 텍스트의 유사성 평가 요청
- [ ] 결과값은 0-100% 범위의 숫자로 반환

### 2.3 음성 인식 기능 (whisperUtils.ts)

- [ ] 브라우저의 MediaRecorder API를 사용하여 오디오 캡처
- [ ] 캡처된 오디오를 Whisper API로 전송하여 텍스트 변환
- [ ] 변환된 텍스트는 노트 복기 모달의 입력창에 자동 삽입

## 3. UI 구성 상세

### 3.1 노트 복기 모달 (noteRecallModal.ts)

#### 헤더 영역
- [ ] 좌측: "노트 복기" 제목 (h2 태그, 좌측 정렬)
- [ ] 우측: 마이크 아이콘 버튼 + 제출 버튼 (우측 정렬)

#### 본문 영역
- [ ] 텍스트 입력창 (textarea, 멀티라인 지원)
- [ ] 입력창 높이는 최소 150px, 자동 확장 지원

#### 상태 표시 영역
- [ ] 마이크 상태 표시 (녹음 중/대기 중)
- [ ] 제출 버튼 클릭 시 "분석 중..." 상태 표시

### 3.2 동작 흐름

- [ ] 1. 마이크 버튼 클릭 → 녹음 시작 → 버튼 색상 변경 (활성화 상태)
- [ ] 2. 마이크 버튼 재클릭 → 녹음 종료 → Whisper API 호출
- [ ] 3. 텍스트 변환 결과 → 입력창에 표시
- [ ] 4. 제출 버튼 클릭 → 정확도 평가 → 결과에 따른 강화 적용/미적용

## 4. 설정 추가

### 4.1 settings.ts 파일 수정

- [ ] 정확도 검증 설정 추가:
```typescript
export interface AILSSSettings {
  // 기존 설정들...
  enablePotentiateAccuracyCheck: boolean;  // 노트 강화 시 정확도 검증 활성화 여부
}

export const DEFAULT_SETTINGS: AILSSSettings = {
  // 기존 설정들...
  enablePotentiateAccuracyCheck: true,  // 기본값은 활성화
};
```

### 4.2 설정 UI 추가

- [ ] 설정 탭에 "노트 강화 정확도 검증" 토글 스위치 추가
- [ ] 정확도 검증을 비활성화하면 기존 강화 로직만 실행 (바로 +1)
- [ ] 정확도 검증 임계값(75%)은 하드코딩으로 유지

### 4.3 하드코딩 설정 값

- [x] 정확도 임계값: 75% (하드코딩)
- [x] 강화 증가값: +1 (하드코딩)

## 5. 구현 단계

### 5.1 기본 구조 구현 (1단계)

- [ ] 1. whisperUtils.ts 파일 생성 및 기본 API 연동 구현
- [ ] 2. accuracyChecker.ts 파일 생성 및 기본 로직 구현
- [ ] 3. settings.ts에 정확도 검증 토글 설정 추가

### 5.2 UI 구현 (2단계)

- [ ] 1. noteRecallModal.ts 생성 및 UI 레이아웃 구현
- [ ] 2. 마이크 녹음 기능 및 이벤트 핸들러 구현
- [ ] 3. 입력 및 제출 로직 구현

### 5.3 로직 통합 (3단계)

- [ ] 1. potentiate.ts 수정하여 정확도 검증 기능 연동
- [ ] 2. 정확도 검증 결과에 따른 강화 적용 로직 구현
- [ ] 3. 설정에 따른 로직 분기 처리 구현

### 5.4 테스트 및 개선 (4단계)

- [ ] 1. 각 기능 단위 테스트
- [ ] 2. 통합 테스트 및 버그 수정
- [ ] 3. 사용자 피드백 반영 및 UI/UX 개선

## 6. 핵심 로직 흐름도

```
[명령어 실행] → [설정 확인]
  ↓
[정확도 검증 활성화?] → (아니오) → [즉시 강화 적용]
  ↓ (예)
[노트 복기 모달 표시]
  ↓
[텍스트 입력 또는 음성 녹음]
  ↓
[제출 버튼 클릭]
  ↓
[정확도 평가 실행]
  ↓
[정확도 ≥ 75%?] → (아니오) → [강화 미적용 + 알림]
  ↓ (예)
[강화 적용 + 알림]
```

## 7. 주요 파일 구현 계획

### 7.1 accuracyChecker.ts

- [ ] 정확도 검증 인터페이스 정의
- [ ] AI 모델 호출 로직 구현
- [ ] 각 AI 제공업체별 처리 분기 구현

```typescript
// src/modules/ai/ai_utils/accuracyChecker.ts

import { AILSSSettings } from 'src/core/settings/settings';

export interface AccuracyResult {
  score: number;  // 0-100 범위의 정확도 점수
  feedback?: string;  // 선택적 피드백 텍스트
}

export async function checkAccuracy(
  originalText: string,
  userInput: string,
  settings: AILSSSettings
): Promise<AccuracyResult> {
  // 선택된 AI 모델에 따라 적절한 API 호출
  const selectedModel = settings.selectedAIModel;
  
  switch(selectedModel) {
    case 'claude':
      return checkAccuracyWithClaude(originalText, userInput, settings.claudeAPIKey, settings.claudeModel);
    case 'openai':
      return checkAccuracyWithOpenAI(originalText, userInput, settings.openAIAPIKey, settings.openAIModel);
    // 다른 모델 케이스 추가
    default:
      throw new Error(`지원되지 않는 AI 모델: ${selectedModel}`);
  }
}

// 구현 계획: 각 AI 모델별 정확도 검증 함수 구현
```

### 7.2 whisperUtils.ts

- [ ] 오디오 녹음 함수 구현
- [ ] Whisper API 연동 구현
- [ ] 오류 처리 로직 구현

```typescript
// src/modules/ai/ai_utils/whisperUtils.ts

export interface WhisperTranscriptionResult {
  text: string;
  confidence?: number;
}

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string
): Promise<WhisperTranscriptionResult> {
  // Whisper API 요청 준비
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('model', 'whisper-1');
  
  // API 호출 및 결과 반환
  // ...
}

export function startRecording(): Promise<MediaRecorder> {
  // 브라우저 오디오 녹음 기능 구현
  // ...
}

export function stopRecording(recorder: MediaRecorder): Promise<Blob> {
  // 녹음 중지 및 오디오 데이터 반환
  // ...
}
```

### 7.3 noteRecallModal.ts

- [ ] 모달 UI 클래스 구현
- [ ] 마이크 버튼 및 제출 버튼 이벤트 핸들러 구현
- [ ] 상태 표시 로직 구현

```typescript
// src/components/potentiateUI/noteRecallModal.ts

import { App, Modal, Setting } from 'obsidian';
import { transcribeAudio, startRecording, stopRecording } from 'src/modules/ai/ai_utils/whisperUtils';
import { checkAccuracy } from 'src/modules/ai/ai_utils/accuracyChecker';

export class NoteRecallModal extends Modal {
  // 속성 정의
  // UI 구성 요소
  // 이벤트 핸들러
  
  constructor(app: App, noteContent: string, onSubmit: (accuracy: number) => void) {
    // 초기화 로직
  }
  
  onOpen() {
    // UI 구성 및 이벤트 핸들러 연결
  }
  
  // 마이크 관련 메소드, 제출 핸들러 등 구현
}
```

### 7.4 potentiate.ts 수정 계획

- [ ] 설정 확인 로직 추가
- [ ] 노트 복기 모달 연동
- [ ] 정확도 기반 강화 적용 로직 구현

```typescript
// src/modules/command/update/potentiate.ts

import { Editor, MarkdownView } from 'obsidian';
import { NoteRecallModal } from 'src/components/potentiateUI/noteRecallModal';

export const potentiateCommand = async (editor: Editor, view: MarkdownView, plugin: AILSSPlugin) => {
  // 설정 확인
  if (!plugin.settings.enablePotentiateAccuracyCheck) {
    // 기존 강화 로직 실행
    return;
  }
  
  // 노트 내용 가져오기
  const noteContent = editor.getValue();
  
  // 노트 복기 모달 열기
  const modal = new NoteRecallModal(plugin.app, noteContent, (accuracy) => {
    // 정확도에 따른 강화 처리
    if (accuracy >= 75) {
      // 강화 로직 실행
      // ...
    } else {
      // 실패 알림
      // ...
    }
  });
  
  modal.open();
};
```

## 8. 기술 스택 및 의존성

- [ ] **AI API**: settings.ts에 설정된 AI 모델 (Claude, OpenAI 등)
- [ ] **음성 변환**: OpenAI Whisper API
- [ ] **UI 컴포넌트**: Obsidian Modal, Setting 컴포넌트 활용
- [ ] **데이터 저장**: Frontmatter 메타데이터 활용
- [ ] **이벤트 처리**: 브라우저 MediaRecorder API

## 9. 구현 시 고려사항

- [ ] **UI 일관성**: 모든 UI 요소는 Obsidian 테마와 일관성 유지
- [ ] **오프라인 대응**: 오프라인 환경에서는 정확도 검증 기능 비활성화 처리
- [ ] **오류 처리**: 마이크 권한 요청 및 API 오류 처리 로직 추가
- [ ] **성능 최적화**: API 호출 최소화, 결과 캐싱 등 성능 고려
- [ ] **접근성**: UI 컴포넌트의 접근성 고려 (키보드 네비게이션, 스크린 리더 지원 등)
- [ ] **보안**: API 키 관리 및 음성 데이터 처리에 대한 보안 고려

## 10. whisperUtils.ts 구현 고려사항

OpenAI Whisper API 활용 시 다음 기술적 사항들을 고려하여 구현합니다:

### 10.1 API 관련 고려사항

#### 파일 제한 및 형식
- [ ] 최대 25MB 크기 제한
- [ ] 지원 형식: mp3, mp4, mpeg, mpga, m4a, wav, webm
- [ ] 브라우저에서 수집된 오디오는 일반적으로 webm 형식으로 저장

#### 모델 선택
- [ ] `whisper-1`: 기본 모델, 다양한 응답 형식 지원
- [ ] `gpt-4o-mini-transcribe`: 고품질 모델(신규)
- [ ] `gpt-4o-transcribe`: 최고 품질 모델(신규)

#### 응답 형식
- [ ] `whisper-1`: json, text, srt, verbose_json, vtt 형식 지원
- [ ] 신규 모델: 현재 json 또는 text 형식만 지원

### 10.2 브라우저 오디오 녹음 구현

#### MediaRecorder API 활용
- [ ] 마이크 접근 권한 요청 기능 구현
- [ ] 오디오 데이터 수집 및 저장 로직 구현
- [ ] 녹음 시작/정지 인터페이스 구현

### 10.3. Whisper API 호출 구현

- [ ] FormData 구성 및 API 요청 기능 구현
- [ ] 응답 처리 및 오류 핸들링 구현
- [ ] API 키 관리 및 설정 연동

### 10.4 정확도 향상을 위한 프롬프트 활용

- [ ] 프롬프트 기반 정확도 향상 기능 구현
- [ ] 노트 컨텍스트 기반 프롬프트 자동 생성 지원

### 10.5 구현 시 고려사항

- [ ] **오프라인 상태 처리**: 네트워크 연결 상태 확인 및 오류 메시지 표시
- [ ] **마이크 권한**: 사용자에게 마이크 접근 권한을 요청하고 거부 시 적절한 안내 제공
- [ ] **녹음 상태 표시**: 녹음 중임을 사용자에게 시각적으로 표시
- [ ] **API 키 관리**: API 키를 안전하게 관리하고 설정에서 가져오기
- [ ] **크기 제한 처리**: 긴 녹음의 경우 25MB 제한을 넘지 않도록 오디오 품질 조정
- [ ] **오류 복구**: API 호출 실패 시 재시도 로직 구현

### 10.6 성능 최적화

- [ ] 짧은 녹음(1-2분 이내)에 최적화하여 UI 응답성 유지
- [ ] 마이크 입력 볼륨 자동 조정으로 인식률 향상
- [ ] 백그라운드에서 API 호출 처리하여 UI 차단 방지

이러한 기술적 고려사항을 바탕으로 whisperUtils.ts를 구현하면 노트 복기 모달에서 안정적인 음성 인식 기능을 제공할 수 있습니다.


---

