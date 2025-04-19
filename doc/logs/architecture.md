# AILSS 플러그인 아키텍처

## 1. 개요

AILSS(AI-assisted Learning and Support System)는 옵시디언(Obsidian)을 위한 AI 통합 플러그인으로, 다양한 AI 서비스를 활용하여 노트 작성, 관리, 시각화, 분석 등의 기능을 제공합니다. 이 플러그인은 모듈식 아키텍처를 기반으로 설계되어 유지보수 용이성과 확장성을 높이고 있습니다.

## 2. 아키텍처 핵심 구성요소

AILSS 플러그인은 다음과 같은 주요 구성요소로 이루어져 있습니다:

### 2.1 핵심 구성요소 (Core Components)

#### AILSSPlugin 클래스
- 플러그인의 진입점이자 메인 클래스
- Obsidian Plugin API 상속 및 구현
- 플러그인 생명주기 관리 (onload, onunload)
- 설정 로드 및 저장 기능
- 레지스트리 초기화 및 관리

#### 레지스트리 시스템
1. **ServiceRegistry**:
   - 모든 서비스 객체 초기화 및 관리
   - 서비스 라이프사이클 관리
   - 서비스 간 의존성 주입 관리

2. **CommandRegistry**:
   - 모든 플러그인 명령어 등록 및 관리
   - 명령어 그룹화 및 카테고리별 관리

3. **RibbonRegistry**:
   - UI 리본(아이콘) 등록 및 관리
   - 리본 아이콘과 명령어 연결

### 2.2 모듈 구조 (Module Structure)

AILSS 플러그인은 기능별로 명확히 분리된 모듈 구조를 가집니다:

```
src/
├── core/                   # 핵심 인프라 코드
│   ├── commandRegistry.ts  # 명령어 등록 및 관리
│   ├── ribbonRegistry.ts   # 리본 UI 요소 관리
│   └── serviceRegistry.ts  # 서비스 객체 관리
│
├── components/             # UI 컴포넌트
│   ├── aiModelStatusBar.ts # AI 모델 상태 표시줄
│   ├── confirmationModal.ts # 확인 대화상자
│   ├── folderSelectionModal.ts # 폴더 선택 모달
│   ├── inputModal.ts       # 입력 모달
│   └── noteRefactoringModal.ts # 노트 리팩토링 모달
│
└── modules/               # 기능별 모듈
    ├── ai/                # AI 관련 기능
    │   ├── ai_utils/      # AI 유틸리티
    │   ├── audio/         # 오디오 관련 기능
    │   ├── image/         # 이미지 관련 기능
    │   └── text/          # 텍스트 처리 기능
    │
    ├── command/           # 명령어 실행 모듈
    │   ├── create/        # 생성 관련 명령어
    │   ├── delete/        # 삭제 관련 명령어
    │   ├── move/          # 이동 관련 명령어
    │   └── update/        # 업데이트 관련 명령어
    │
    └── maintenance/       # 시스템 유지보수 모듈
        ├── settings/      # 설정 관련 기능
        └── utils/         # 유틸리티 기능
```

## 3. 주요 설계 패턴

AILSS 플러그인에서 사용된 주요 설계 패턴은 다음과 같습니다:

### 3.1 레지스트리 패턴 (Registry Pattern)
- 서비스, 명령어, UI 요소 등의 중앙 집중식 관리
- 전역적인 접근 지점 제공
- 의존성 관리 및 초기화 순서 제어

### 3.2 의존성 주입 패턴 (Dependency Injection)
- 생성자를 통한 의존성 주입
- 서비스 간 결합도 감소
- 테스트 용이성 증가

### 3.3 컴포지트 패턴 (Composite Pattern)
- 노트 구조 및 폴더 구조 관리에 활용
- 재귀적 작업 처리 (예: 무결성 검사)

### 3.4 커맨드 패턴 (Command Pattern)
- 다양한 명령어를 객체로 캡슐화
- 실행 메커니즘과 명령 분리

### 3.5 팩토리 패턴 (Factory Pattern)
- 서비스 객체 생성 로직 분리
- 인스턴스 생성 중앙화

## 4. AI 통합 아키텍처

AILSS는 다양한 AI 서비스 제공업체를 통합하는 아키텍처를 가집니다:

### 4.1 지원하는 AI 제공업체
- OpenAI (GPT 시리즈, DALL-E, TTS 모델)
- Claude (Anthropic의 Claude 모델)
- Perplexity (Perplexity AI 모델)
- Google AI (Gemini 모델)

### 4.2 AI 요청 처리 흐름
1. 사용자 입력 수집
2. AI 프롬프트 생성
3. 선택된 AI 제공업체 API 호출
4. 응답 처리 및 변환
5. 결과를 옵시디언에 통합

### 4.3 AI 모듈 구조
```
modules/ai/
├── ai_utils/                # AI 유틸리티 함수
│   ├── aiBatchProcessor.ts  # 일괄 처리 기능
│   ├── aiEditorUtils.ts     # 에디터 연동 유틸리티
│   ├── aiImageUtils.ts      # 이미지 관련 유틸리티
│   ├── aiUtils.ts           # 일반 AI 유틸리티
│   └── aiVisionAPI.ts       # 비전 API 통합
│
├── audio/                   # 오디오 처리
│   └── openai_tts.ts        # OpenAI TTS 연동
│
├── image/                   # 이미지 처리
│   ├── aiImageAnalyzer.ts   # 이미지 분석
│   ├── aiImageCreator.ts    # 이미지 생성
│   └── aiOCR.ts             # 텍스트 추출(OCR)
│
└── text/                    # 텍스트 처리
    ├── aiAnswer.ts          # AI 응답 생성
    ├── aiLatexMath.ts       # LaTeX 수식 변환
    ├── aiLinkNote.ts        # 노트 연결
    ├── aiNoteRefactor.ts    # 노트 리팩토링
    ├── aiNoteRestructure.ts # 노트 구조 재구성
    ├── aiProcess.ts         # AI 명령 처리
    ├── aiReformat.ts        # 텍스트 재포맷
    ├── aiTagAliasRefactor.ts # 태그/별칭 관리
    └── aiVisualizer.ts      # 시각화 생성
```

## 5. 설정 및 상태 관리

### 5.1 설정 구조
- `AILSSSettings` 인터페이스를 통한 설정 타입 정의
- `DEFAULT_SETTINGS` 상수로 기본값 제공
- 설정 저장 및 로드 메커니즘
- 마스킹된 API 키 관리 (보안)

### 5.2 설정 UI
- `AILSSSettingTab` 클래스로 설정 페이지 구현
- 카테고리별 설정 그룹화 (AI 모델, API 키, 기타 설정)
- 드롭다운, 토글 등 다양한 설정 컴포넌트 제공

### 5.3 상태 관리
- `AIModelStatusBar`를 통한 현재 선택된 AI 모델 표시
- 실시간 상태 업데이트
- 사용자 인터랙션을 통한 빠른 모델 전환

## 6. 데이터 흐름

AILSS 플러그인의 주요 데이터 흐름은 다음과 같습니다:

### 6.1 플러그인 초기화 흐름
```
AILSSPlugin.onload()
  ↓
  설정 로드
  ↓
  ServiceRegistry 초기화
  ↓
  모든 서비스 초기화
  ↓
  CommandRegistry 초기화 및 명령어 등록
  ↓
  RibbonRegistry 초기화 및 UI 요소 등록
  ↓
  AIModelStatusBar 초기화
```

### 6.2 명령어 실행 흐름
```
사용자 명령어 실행
  ↓
  CommandRegistry에서 명령어 매핑
  ↓
  해당 서비스의 메서드 호출
  ↓
  필요 시 AI API 요청
  ↓
  결과 처리 및 옵시디언에 적용
```

### 6.3 AI 요청 처리 흐름
```
AI 기능 요청
  ↓
  입력 데이터 준비
  ↓
  설정에서 선택된 AI 모델 및 API 키 로드
  ↓
  AI 프로바이더별 처리 함수 호출
  ↓
  API 응답 처리
  ↓
  결과를 옵시디언 노트에 적용
```

## 7. 확장성 및 유지보수성

### 7.1 확장 지점
- 새로운 AI 서비스 추가 용이
- 독립적인 명령어 모듈 확장
- 새로운 UI 컴포넌트 추가 가능

### 7.2 모듈 간 의존성 관리
- 명확한 의존성 흐름
- 인터페이스를 통한 구현 분리
- 중앙 집중식 서비스 레지스트리

### 7.3 에러 처리 및 로깅
- 일관된 에러 처리 패턴
- 사용자 친화적인 알림
- 디버깅을 위한 로깅 시스템

## 8. 테스트 전략

AILSS 플러그인은 다양한 수준의 테스트를 통해 품질을 보장합니다:

- 단위 테스트: 개별 함수 및 유틸리티 기능 테스트
- 통합 테스트: 서비스 간 상호작용 테스트
- E2E 테스트: 사용자 시나리오 기반 테스트

## 9. 결론

AILSS 플러그인은 모듈식 아키텍처, 레지스트리 패턴, 의존성 주입 등의 설계 패턴을 활용하여 확장성과 유지보수성이 뛰어난 구조로 설계되었습니다. 다양한 AI 서비스를 통합하고 옵시디언 노트 관리 기능을 강화하여 사용자 워크플로우를 효율적으로 개선합니다. 명확한 모듈 구조와 의존성 관리를 통해 새로운 기능 추가가 용이하며, 체계적인 오류 처리 메커니즘을 통해 안정적인 사용자 경험을 제공합니다.