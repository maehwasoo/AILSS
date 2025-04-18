# 개발 로그

## 2025년 4월 18일 - OpenAI o 시리즈 API 수정

### 배경
OpenAI의 o 시리즈 모델(o1, o3, o4 등)을 사용하여 이미지 요청을 보낼 때 지속적으로 400 오류가 발생하는 문제가 있었습니다. 공식 OpenAI 문서를 참고하여 이 문제의 해결을 시도했습니다. 문제는 o 시리즈 모델에 맞는 요청 형식을 적용하지 않아 발생했습니다.

### 원인 분석
1. **API 엔드포인트 문제**:
   - 이전에는 o 시리즈 모델 요청을 `/v1/responses` 엔드포인트로 보내도록 구현했습니다.
   - 그러나 실제 API 응답에서는 여전히 400 오류가 발생했습니다.
   - 공식 문서에서는 새로운 엔드포인트를 언급했으나, 테스트 결과 기존 `/v1/chat/completions` 엔드포인트를 사용해야 했습니다.

2. **요청 형식 불일치**:
   - 이전 구현에서는 o 시리즈 모델에 맞춰 `input_text`, `input_image` 타입을 사용했습니다.
   - 테스트 결과, o 시리즈 모델은 기존 GPT 모델과 같은 `text`, `image_url` 타입을 사용해야 했습니다.

3. **시스템 프롬프트 위치**:
   - 이전에는 시스템 프롬프트를 최상위 레벨의 `system` 파라미터로 전달했습니다.
   - o 시리즈 모델은 시스템 프롬프트를 별도로 받지 않고, 유저 프롬프트에 통합하는 것이 필요했습니다.

### 구현 변경 사항

1. **API 엔드포인트 수정**:
   - o 시리즈 모델 요청을 `/v1/chat/completions` 엔드포인트로 변경했습니다.
   - 응답 처리 방식도 일반 GPT 모델과 동일하게 수정했습니다.

   ```typescript
   // 이전 코드 (o 시리즈는 새로운 API 형식 사용)
   if (modelId.startsWith('o')) {
     url = 'https://api.openai.com/v1/responses';
     // ...
     if (response.status === 200) {
       return response.json.output_text.trim();
     }
   }

   // 수정 코드 (o 시리즈는 기존 API 형식을 사용)
   if (modelId.startsWith('o')) {
     url = 'https://api.openai.com/v1/chat/completions';
     // ...
     if (response.status === 200) {
       return response.json.choices[0].message.content.trim();
     }
   }
   ```

2. **요청 구조 변경**:
   - o 시리즈 모델에 맞는 메시지 구조로 변경했습니다.
   - `input_text` → `text`, `input_image` → `image_url` 타입으로 변경했습니다.

   ```typescript
   // 이전 코드
   data = {
     model: modelId,
     input: [
       {
         role: "user",
         content: [
           { type: "input_text", text: combinedPrompt },
           { 
             type: "input_image", 
             image_url: `data:image/jpeg;base64,${base64Image}`,
             detail: "high" 
           }
         ]
       }
     ],
     system: systemPrompt,  // 최상위 레벨의 system 파라미터
     temperature: 0.3,
     max_tokens: 4000
   };

   // 수정 코드
   data = {
     model: modelId,
     messages: [
       {
         role: "user",
         content: [
           { type: "text", text: combinedPrompt },
           {
             type: "image_url",
             image_url: {
               url: `data:image/jpeg;base64,${base64Image}`
             }
           }
         ]
       }
     ],
     temperature: 0.3,
     max_tokens: 4000
   };
   ```

3. **프롬프트 통합**:
   - 시스템 프롬프트와 유저 프롬프트를 하나로 통합했습니다.
   - `aiAnswer.ts`의 접근 방식을 참고하여 단일 프롬프트로 병합했습니다.

   ```typescript
   // 시스템 프롬프트와 유저 프롬프트 결합
   const combinedPrompt = ocr ? 
     `${systemPrompt}\n\n${userPrompt}` : 
     `${systemPrompt}\n\n${userPrompt}`;
   ```

4. **디버깅 개선**:
   - 긴 요청 데이터는 일부만 로깅하도록 개선했습니다.
   - 오류 발생 시 더 상세한 정보를 제공하는 로깅을 추가했습니다.

   ```typescript
   console.log('O 시리즈 요청 형식:', JSON.stringify(data).substring(0, 200) + '...');
   // ...
   console.log('응답 상태 코드:', response.status);
   // ...
   console.log('오류 응답:', JSON.stringify(response.json));
   ```

### 결과 및 교훈
1. **API 통합의 중요성**:
   - OpenAI의 공식 문서가 항상 최신 API 동작을 정확히 반영하지는 않을 수 있습니다.
   - o 시리즈 모델은 문서에 명시된 것과 다르게, 기존 GPT 모델과 유사한 API 구조를 사용했습니다.

2. **유연한 설계의 필요성**:
   - 외부 API가 변경될 가능성을 고려하여 코드를 더 유연하게 설계해야 합니다.
   - 모델별 분기 처리를 더 체계적으로 관리할 필요가 있습니다.

3. **테스트의 중요성**:
   - API 변경 시 철저한 테스트가 필요합니다.
   - 다양한 모델과 요청 형식에 대한 테스트 케이스를 준비해야 합니다.

이 수정을 통해 o 시리즈 모델을 사용한 이미지 분석이 정상적으로 작동하게 되었으며, 사용자는 이제 모든 OpenAI 모델에서 일관된 경험을 얻을 수 있게 되었습니다.

## 2025년 4월 18일 - main.ts 모듈화

### 배경
기존의 `main.ts` 파일은 모든 서비스, 명령어, 리본 아이콘 등의 초기화 코드가 하나의 파일에 집중되어 있어 파일의 길이가 길고 유지 보수가 어려웠습니다. 코드베이스가 커짐에 따라 새로운 기능을 추가하거나 기존 기능을 수정할 때마다 `main.ts` 파일이 더 복잡해지는 문제가 있었습니다.

### 모듈화 전략
`main.ts`를 세 개의 핵심 레지스트리 클래스로 분리하는 모듈화 작업을 수행했습니다:

1. **ServiceRegistry (`src/core/serviceRegistry.ts`)**
   - 모든 매니저 객체와 서비스를 초기화하고 관리하는 중앙 레지스트리
   - 서비스들을 논리적인 그룹(노트 생성, 업데이트, AI 서비스 등)으로 구성
   - 각 서비스에 대한 게터 메서드를 제공하여 접근성 향상

2. **CommandRegistry (`src/core/commandRegistry.ts`)**
   - 모든 명령어 등록을 담당
   - 명령어들을 논리적인 그룹별로 등록 메서드 분리
   - 명령어 콜백 함수에서 필요한 서비스를 ServiceRegistry를 통해 접근

3. **RibbonRegistry (`src/core/ribbonRegistry.ts`)**
   - 모든 리본 메뉴 아이콘과 관련 동작을 관리
   - 기능별로 리본 아이콘 그룹화
   - 아이콘 클릭 시 ServiceRegistry를 통해 필요한 서비스 접근

### 모듈화의 이점

1. **관심사 분리**
   - 각 레지스트리는 명확한 책임과 역할을 가짐
   - 코드의 응집도 향상 및 결합도 감소

2. **유지 보수성 향상**
   - 기능별로 코드가 분리되어 관련 코드를 쉽게 찾고 수정 가능
   - 버그 수정이나 기능 확장 시 영향 범위 최소화

3. **가독성 개선**
   - 각 파일이 더 짧고 집중된 코드로 구성됨
   - 명확한 구조와 네이밍으로 코드 이해 용이

4. **확장성 강화**
   - 새로운 기능이나 서비스 추가 시 관련 레지스트리만 수정
   - 플러그인 아키텍처가 체계적으로 정리되어 향후 확장에 대비

5. **테스트 용이성**
   - 분리된 모듈은 독립적으로 테스트 가능
   - 의존성 주입을 통한 모의 객체 사용 가능

### 구현 세부 사항
- 레지스트리 간의 의존성 관리를 위해 생성자 주입 방식 사용
- `main.ts`는 각 레지스트리의 초기화와 조정에만 집중
- 모든 서비스는 `ServiceRegistry`를 통해서만 접근하도록 표준화
- 직접 노출이 필요한 일부 서비스(예: noteRefactoringManager)만 main 클래스에 직접 참조

