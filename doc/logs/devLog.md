# 개발 로그

## 2025년 4월 19일 - OpenAI o 시리즈 API 지속적인 오류 해결 시도

### 문제 상황
OpenAI의 o 시리즈 모델(o1, o3, o4 등)을 사용한 이미지 분석 API 요청이 여전히 400 오류를 반환하고 있습니다. 18일에 시도한 API 엔드포인트와 요청 형식 수정에도 불구하고 문제가 지속되고 있습니다.

### 이전 시도 요약
- `/v1/responses` 엔드포인트에서 `/v1/chat/completions` 엔드포인트로 변경
- `input_text`, `input_image` 타입에서 `text`, `image_url` 타입으로 변경
- 시스템 프롬프트 분리 대신 유저 프롬프트에 통합

### 최신 시도 내용

1. **요청 형식 재검토**:
   - 공식 OpenAI 문서와 실제 구현의 차이점을 다시 철저히 검토
   - `text`와 `image_url` 타입이 OpenAI 문서에서는 `input_text`와 `input_image`로 명시되어 있음을 확인
   - `detail` 파라미터 위치를 확인하여 `image_url` 객체 내부에서 `url`과 같은 레벨로 수정

2. **API 호출 형식 수정**:
   ```typescript
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
               url: `data:image/jpeg;base64,${base64Image}`,
               detail: "high"
             }
           }
         ]
       }
     ],
     temperature: 0.3,
     max_tokens: 4000
   };
   ```

3. **오류 로깅 강화**:
   - 요청 헤더, 파라미터, 응답 상태 코드 등을 더 상세히 로깅
   - 오류 응답의 전체 JSON 데이터 캡처하여 구체적인 실패 이유 분석
   - 로컬 저장소에 로그 기록 추가

4. **워크어라운드 검토**:
   - o 시리즈 모델에서 오류 발생시 자동으로 gpt-4o 모델로 대체하는 폴백 메커니즘 구현 검토
   - 일반 GPT 모델과 o 시리즈 모델의 요청/응답 차이 비교를 위한 디버깅 모드 추가

### 오류 분석 결과

API 오류 응답에서 확인된 주요 메시지:
```json
{
  "error": {
    "message": "Invalid schema for 'content[1].image_url': value is not an object",
    "type": "invalid_request_error",
    "param": null,
    "code": null
  }
}
```

추정되는 문제 원인:
1. **문서와 실제 API의 불일치**: OpenAI 문서에서 설명한 API 형식과 실제 API가 요구하는 형식 간의 차이
2. **복합적 파라미터 구조 문제**: 'image_url' 파라미터의 중첩된 구조와 필수 필드에 대한 해석 차이
3. **모델별 API 차이점**: o 시리즈와 GPT 모델 간의 API 차이점이 문서에 명확히 설명되어 있지 않음

### 다음 계획

1. **추가 테스트**:
   - 단순한 테스트 케이스를 만들어 다양한 요청 형식 시도
   - cURL을 통한 직접 API 호출 테스트로 라이브러리/코드 문제 여부 확인
   - Python 및 Node.js에서 제공하는 공식 예제 코드와 비교

2. **임시 대안 구현**:
   - o 시리즈 모델 요청 시 자동으로 gpt-4o로 대체하는 폴백 메커니즘 임시 구현
   - 사용자에게 o 시리즈 모델의 제한사항 안내 메시지 추가

3. **OpenAI 커뮤니티 및 지원 문의**:
   - OpenAI 개발자 포럼에 문제 상황 공유 및 해결책 문의
   - 다른 개발자들의 경험 수집

### 교훈

1. **API 문서의 한계**:
   - 공식 문서가 항상 최신 API 동작을 정확히 반영하지 않을 수 있음
   - 특히 새로운 모델이나 기능은 API 스펙이 자주 변경될 가능성이 높음

2. **확장성 고려 설계**:
   - 다양한 API 변경에 쉽게 대응할 수 있는 모듈화된 설계 필요
   - 특정 모델/API에 종속되지 않는 중간 레이어 구현 고려

3. **사용자 경험 우선**:
   - API 오류가 발생하더라도 최종 사용자 경험에 영향을 최소화하는 접근 방식 필요
   - 명확한 오류 메시지와 대안 제시로 사용자 혼란 방지

## 2025년 4월 19일 - 중복 노트 검색 및 확인 기능 구현

### 배경
노트 생성 시 비슷한 제목의 노트가 이미 존재하는 경우에도 사용자가 인지하지 못하고 새로운 노트를 생성하는 경우가 많았습니다. 이로 인해 비슷한 내용의 노트가 중복 생성되어 지식 관리의 효율성이 저하되는 문제가 있었습니다.

### 구현 전략
1. **프론트매터 기반 검색 유틸리티 개발**:
   - 제목 및 별칭(aliases)을 기반으로 노트를 검색하는 `FrontmatterSearchUtils` 클래스 구현
   - 텍스트 유사도 알고리즘을 적용하여 정확한 일치뿐만 아니라 유사한 제목의 노트도 검색 가능하도록 기능 구현

2. **모달 UI 컴포넌트 개발**:
   - 사용자에게 검색 결과를 보여주는 `TitleSearchModal` 컴포넌트 구현
   - 기존 노트 선택, 새 노트 생성, 취소 등의 옵션을 제공하는 인터페이스 마련
   - 기존 모달 컴포넌트들과 일관된 디자인 스타일 적용

3. **노트 생성 클래스에 통합**:
   - `LinkNote`, `CopyNote`, `EmbedNote`, `AILinkNote` 등 노트 생성 관련 클래스에 검색 및 확인 로직 통합
   - 모든 노트 생성 프로세스에서 중복 확인 과정을 표준화

### 구현 세부 사항

1. **프론트매터 검색 유틸리티 (`frontmatterSearchUtils.ts`)**:
   ```typescript
   static async searchNotesByTitle(
       app: App, 
       searchText: string, 
       fuzzyMatch: boolean = true,
       maxResults: number = 10
   ): Promise<{file: TFile, title: string, matchType: 'title'|'alias'|'both'}[]>
   ```
   - 유사도 계산 알고리즘을 사용하여 결과를 정밀하게 순위화
   - 제목, 별칭, 또는 둘 다에서 일치하는 경우를 구분하여 반환

2. **검색 결과 표시 모달 (`titleSearchModal.ts`)**:
   ```typescript
   export async function showTitleSearchModal(
       app: App, 
       options: Omit<TitleSearchModalOptions, 'onSelect' | 'onCreateNew' | 'onCancel'>
   ): Promise<{action: 'select' | 'create' | 'cancel', selectedFile?: TFile}>
   ```
   - 비동기 Promise 기반으로 사용자 선택 결과 반환
   - 각 검색 결과 항목은 제목, 매칭 타입, 파일 경로를 시각적으로 표시

3. **노트 생성 클래스에 통합**:
   - 모든 노트 생성 과정에 공통적으로 적용되는 표준화된 흐름:
     1. 선택된 텍스트에 대한 유사 노트 검색
     2. 검색 결과가 있으면 사용자에게 확인 모달 표시
     3. 사용자 선택에 따라 기존 노트 링크 또는 새 노트 생성
     4. 노트 간 이동 시에도 원래 선택했던 텍스트의 위치 추적 및 링크 삽입

### 결과
1. **사용자 경험 향상**:
   - 노트 생성 전에 유사한 노트가 이미 존재하는지 확인할 수 있게 되어 중복 노트 생성 방지
   - 검색 결과를 통해 관련 노트를 쉽게 발견하고 활용 가능
   - 모달 UI를 통해 직관적인 사용자 인터페이스 제공

2. **시스템 효율성 개선**:
   - 중복 노트 감소로 지식 베이스의 일관성 향상
   - 노트 간의 연결성이 증가하여 전체 그래프 구조 개선
   - 기존 노트의 재사용성 향상으로 지식 관리 효율 증대

3. **기술적 개선**:
   - 재사용 가능한 검색 유틸리티로 다른 기능에서도 활용 가능
   - 모듈화된 구조로 유사한 기능 확장이 용이
   - 비동기 작업 처리 및 사용자 인터랙션 패턴 표준화

## 2025년 4월 18일 - Google Imagen API 구현 및 수정

### 배경
Google의 Imagen API를 사용하여 이미지 생성 기능을 구현하려 했으나, API 요청 시 지속적으로 400 오류가 발생했습니다. 공식 문서와 실제 API의 불일치로 인해 여러 시행착오를 겪었습니다.

### 원인 분석
1. **API 요청 형식 불일치**:
   - 처음에는 OpenAI API와 비슷한 구조로 요청을 구성했으나, Google Imagen API는 다른 형식을 요구했습니다.
   - 초기 구현에서는 `contents` 배열과 `generationConfig`를 사용했으나, 계속해서 400 오류가 반환되었습니다.

2. **API 엔드포인트 문제**:
   - 처음에는 `/v1/models/imagen-3.0-generate-002:generateContent` 엔드포인트를 사용했으나 실제로는 다른 엔드포인트가 필요했습니다.
   - 공식 문서에서 제시한 엔드포인트는 `/v1beta/models/imagen-3.0-generate-002:predict`였습니다.

3. **요청 본문 구조 차이**:
   - `contents` 배열과 `generationConfig` 대신 `instances`와 `parameters` 구조를 사용해야 했습니다.
   - `aspectRatio`와 같은 매개변수의 위치도 다른 계층에 위치해야 했습니다.

### 구현 변경 사항

1. **API 엔드포인트 수정**:
   ```typescript
   // 이전 코드
   const url = 'https://generativelanguage.googleapis.com/v1/models/imagen-3.0-generate-002:generateContent';
   
   // 수정 코드
   const url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict';
   ```

2. **요청 본문 구조 변경**:
   ```typescript
   // 이전 코드
   const data = {
     contents: [{
       role: "user",
       parts: [{
         text: prompt
       }]
     }],
     generationConfig: {
       aspectRatio: aspectRatio,
       numberOfImages: 3
     }
   };

   // 수정 코드
   const data = {
     "instances": [
       {
         "prompt": prompt
       }
     ],
     "parameters": {
       "sampleCount": 1,
       "aspectRatio": aspectRatio
     }
   };
   ```

3. **응답 처리 로직 수정**:
   ```typescript
   // 이전 코드
   if (responseData.candidates && responseData.candidates.length > 0) {
     for (const candidate of responseData.candidates) {
       if (candidate.content && candidate.content.parts) {
         for (const part of candidate.content.parts) {
           if (part.inlineData && part.inlineData.data) {
             // 이미지 처리
           }
         }
       }
     }
   }

   // 수정 코드
   if (responseData.predictions) {
     for (const prediction of responseData.predictions) {
       if (prediction.bytesBase64Encoded) {
         // Base64 이미지 데이터를 임시 data:URI로 변환
         const imageUrl = `data:image/png;base64,${prediction.bytesBase64Encoded}`;
         images.push(imageUrl);
       }
     }
   }
   ```

4. **프롬프트 처리 개선**:
   - 초기에는 한글 프롬프트를 영어로 변환하는 등의 추가 처리를 시도했으나, 최종적으로는 원본 프롬프트를 그대로 사용하는 방식으로 간소화했습니다.

### 시도했던 접근법

1. **프롬프트 전처리**:
   - OCR 결과를 이미지 생성에 적합한 형식으로 변환
   - 한글 프롬프트에 영어 설명을 추가하는 기능 구현
   - 특정 패턴의 메타데이터 제거

2. **API 매개변수 조정**:
   - `responseMimeType` 지정
   - `sampleCount`, `numberOfImages` 값 변경
   - 헤더 정보 추가 및 조정

3. **오류 로깅 개선**:
   - 응답 본문 파싱 및 세부 오류 로깅
   - 요청 데이터 상세 출력
   - 오류 패턴 분석을 위한 추가 로깅

### 결과

1. **API 문서의 중요성**:
   - 공식 문서와 실제 API 구현 사이에 차이가 있을 수 있음을 인식
   - 문서 내용을 그대로 적용하기보다 실제 테스트를 통한 검증이 필요

2. **점진적 접근법의 유용성**:
   - 복잡한 기능을 추가하기 전에 기본 API 호출이 작동하는지 확인
   - 한 번에 여러 변수를 변경하지 않고 단계적으로 테스트

## 2025년 4월 18일 - 첨부파일 이름 동기화 모듈 개선

### 배경
기존 첨부파일 이름 동기화 기능은 노트 내에서 첨부파일 링크를 노트 이름에 맞게 자동으로 변경하는 기능을 제공했습니다. 그러나 노트 A에서 B로 첨부파일 링크를 옮기는 경우, 파일 이름이 여전히 원래 노트(A)의 이름을 유지하는 문제가 있었습니다.

### 원인 분석
1. **이름 검증 로직의 한계**:
   - 기존 코드는 단순히 파일 경로에 현재 노트 이름이 포함되어 있는지 확인하는 방식을 사용했습니다.
   ```typescript
   if (originalPath.includes(`${currentFile.basename}-`)) {
       console.log("이미 이름이 변경된 파일:", originalPath);
       continue;
   }
   ```
   - 이로 인해 다른 노트에서 이동된 첨부파일의 경우에도 이름 변경 처리가 스킵되었습니다.

2. **노트 간 이동 시나리오 미고려**:
   - 노트 A에서 첨부파일 이름이 `A-1.png`로 설정된 경우
   - 노트 B로 해당 링크를 이동했을 때 `B-1.png`로 업데이트되어야 함
   - 하지만 기존 로직에서는 이런 경우를 처리하지 않았습니다.

### 구현 변경 사항

1. **파일명 패턴 분석 개선**:
   - 정규 표현식을 사용하여 파일명이 `노트명-숫자.확장자` 패턴을 따르는지 정확히 분석합니다.
   ```typescript
   const fileNamePattern = /^(.+)-(\d+)\.(.+)$/;
   const fileNameMatch = originalPath.match(fileNamePattern);
   
   // 현재 노트에 이미 맞게 이름이 지정된 경우만 스킵
   if (fileNameMatch && fileNameMatch[1] === currentFile.basename) {
       console.log("이미 현재 노트에 맞게 이름이 변경된 파일:", originalPath);
       continue;
   }
   ```

2. **노트 간 이동 처리 로직 추가**:
   - 다른 노트에서 이동된 첨부파일도 현재 노트 이름 기준으로 이름을 변경하도록 했습니다.
   - 파일 이름 형식이 `노트명-숫자.확장자` 패턴을 따르더라도 현재 노트 이름과 다르면 업데이트됩니다.

3. **로깅 개선**:
   - 파일 이름 변경 과정을 더 자세히 로깅하여 디버깅을 용이하게 했습니다.
   ```typescript
   console.log("처리중인 경로:", originalPath);
   console.log("현재 노트 경로:", currentParentPath);
   console.log("첨부파일 찾음:", attachmentFile?.path);
   console.log("새 경로:", newPath);
   ```

### 결과
1. **엣지 케이스 처리의 중요성**:
   - 다양한 사용자 시나리오를 고려하여 코드를 설계해야 합니다.
   - 특히 이름 패턴 매칭과 같은 경우 정확한 패턴 분석이 중요합니다.

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

### 문제 해결 시도

1. **공식 문서 기반 구현**
   - OpenAI의 Vision API와 Reasoning 모델 문서를 참고하여 o 시리즈 모델용 요청 방식 재구현
   - `/v1/responses` 엔드포인트와 `input_text`/`input_image` 형식 시도
   - `reasoning` 파라미터 추가 및 `max_output_tokens` 사용

2. **여러 구현 방식 테스트**
   - 여러 요청 구조와 API 엔드포인트 조합을 시도
   - 공식 문서와 실제 API 동작 간의 차이점 분석
   - 자세한 오류 메시지 로깅 추가로 문제 원인 파악

3. **대체 솔루션 검토**
   - 지속적인 API 오류 발생 시 Claude나 Gemini 등 다른 비전 모델로 대체하는 방안 고려
   - 필요 시 OpenAI GPT-4o 모델로 자동 대체하는 방안 검토 (사용자 경험 중단 방지)

### 결과

1. **API 문서와 실제 동작 간 차이**
   - OpenAI의 공식 문서가 항상 최신 API 동작을 반영하지 않을 수 있음
   - 실제 테스트를 통한 검증이 중요함

2. **로깅과 디버깅의 중요성**
   - 엔드포인트, 요청 형식, 응답 데이터를 자세히 로깅하여 문제 원인 파악
   - 오류 처리 로직 개선으로 사용자에게 더 명확한 오류 메시지 제공

3. **유연한 설계의 필요성**
   - API 스펙 변경에 대응할 수 있는 유연한 코드 구조 필요
   - 서로 다른 AI 제공업체와 모델들이 각각 다른 API 형식을 가질 수 있음을 고려한 설계

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

### 구현 세부 사항
- 레지스트리 간의 의존성 관리를 위해 생성자 주입 방식 사용
- `main.ts`는 각 레지스트리의 초기화와 조정에만 집중
- 모든 서비스는 `ServiceRegistry`를 통해서만 접근하도록 표준화
- 직접 노출이 필요한 일부 서비스(예: noteRefactoringManager)만 main 클래스에 직접 참조

