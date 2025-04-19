potentiate 모듈은 현재 노트에서 모듈을 실행하면 강화 potentiation 속성 값이 +1이 되는 모듈인데,
모달을 통해 해당 노트 내용을 입력 받거나 또는 마이크로 openai whisper 모델을 통해 노트 내용을 입력 받고, 

이를 ai를 통해 정확도를 판별해서 정확도가 75% 이상일 때만 강화가 +1되는 로직을 추가하고 싶어

모두 요지보수가 쉽고, 언제든 끄고 켤 수 있도록 모듈화를 하고, 모달 UI나 AI 유틸들은 아래 경로들을 확인하여 기존에 있던 모듈들을 최대한 재활용하는 방향으로 해서 통일 시켜

@ai/ai_utils @src/components

또한 현재는 potentiate 모듈 파일 하나밖에 없긴한데, 모듈이 많아지면, 적절하게 강화 모듈 경로를 만들어서 모듈 파일들을 묶어


## 세부 구현 계획

### 1. 모듈 구조 재구성

#### 1.1 디렉토리 구조
```
src/
└── modules/
    └── potentiation/  # 새로운 강화 모듈 전용 디렉토리
        ├── core/
        │   ├── potentiateManager.ts  # 기존 potentiate.ts를 개선하여 이동
        │   └── potentiateSettings.ts # 설정 관리 클래스
        ├── ui/
        │   ├── potentiateModal.ts    # 텍스트 입력용 모달
        │   └── audioInputModal.ts    # 오디오 입력용 모달
        └── services/
            ├── accuracyChecker.ts    # AI 정확도 평가 서비스
            ├── textProcessor.ts      # 텍스트 처리 서비스
            └── audioProcessor.ts     # 오디오 처리 서비스 (Whisper 연동)
```

#### 1.2 기존 코드 이전 및 확장
- `src/modules/command/update/potentiate.ts`를 `potentiateManager.ts`로 확장 이전
- 기존 코드의 강화 로직은 그대로 유지하되, 새로운 기능을 위한 인터페이스 추가

### 2. 기능 구현 계획

#### 2.1 텍스트 입력 기능
- `src/components/inputModal.ts`를 활용하여 `potentiateModal.ts` 구현
- 노트 내용과 입력된 텍스트를 비교하는 accuracyChecker 서비스 구현

#### 2.2 오디오 입력 기능
- OpenAI Whisper API 연동 (src/modules/ai/audio에 있는 모듈 활용)
- 마이크 입력을 받아 텍스트로 변환하는 audioProcessor 서비스 구현
- 변환된 텍스트를 노트 내용과 비교하는 로직 연결

#### 2.3 정확도 검증 기능
- AI를 활용한 정확도 평가 로직 구현 (OpenAI API 활용)
- 노트 내용과 입력된 내용의 유사도 계산
- 75% 이상일 때만 강화를 적용하는 조건문 추가

### 3. 설정 및 토글 기능

#### 3.1 설정 기능
- 플러그인 설정에 강화 모듈 관련 옵션 추가
  - 강화 기능 활성화/비활성화 토글
  - 정확도 평가 임계값 설정 (기본값 75%)
  - 텍스트/오디오 입력 방식 선택

#### 3.2 사용자 인터페이스
- 설정 변경을 위한 UI 컴포넌트 구현
- 강화 진행 과정을 보여주는 피드백 UI 개선

### 4. AI 모듈 활용 계획

#### 4.1 텍스트 유사도 평가
- `src/modules/ai/ai_utils/aiUtils.ts`의 AI 기능 활용
- 임베딩 또는 의미론적 비교를 통한 정확도 측정

#### 4.2 오디오 처리
- Whisper API 연동 (src/modules/ai/audio 모듈 활용)
- 음성 인식 결과의 신뢰도 평가

### 5. 구현 단계

#### 단계 1: 기본 구조 구현
1. 새로운 디렉토리 구조 생성
2. 기존 potentiate.ts 코드를 potentiateManager.ts로 이전 및 확장
3. 설정 관리 클래스 구현

#### 단계 2: UI 구현
1. 텍스트 입력 모달 구현
2. 오디오 입력 인터페이스 구현
3. 피드백 UI 구현

#### 단계 3: 서비스 구현
1. 텍스트 처리 서비스 구현
2. 오디오 처리 서비스 구현 (Whisper API 연동)
3. 정확도 평가 서비스 구현

#### 단계 4: 통합 및 테스트
1. 모든 컴포넌트 통합
2. 설정 UI와 기능 연결
3. 종합 테스트 및 디버깅

### 6. 기술 스택 및 의존성

- TypeScript: 전체 코드베이스
- Obsidian API: 플러그인 프레임워크
- OpenAI API: 
  - Whisper: 음성-텍스트 변환
  - GPT/임베딩: 정확도 평가
- 기존 플러그인 컴포넌트:
  - inputModal.ts: 텍스트 입력 UI
  - confirmationModal.ts: 사용자 확인 UI
  - FrontmatterManager: 메타데이터 관리

