# 코딩 컨벤션(coding convention)

이 문서는 AILSS 코드베이스의 코딩 규칙을 정의해요.

## 언어/런타임

- TypeScript + Node.js
- ESM(ECMAScript Modules) 기반(`"type": "module"`)
- tsconfig는 `tsconfig.base.json`을 기준으로 하고, strict 모드를 유지해요

## 패키지 구조와 의존 방향

- `@ailss/core`는 공용 로직만 포함해요(다른 패키지에 의존하지 않아요)
- `@ailss/indexer`, `@ailss/mcp`는 `@ailss/core`만 의존해요
- MCP 서버(server)는 기본적으로 읽기(read-only) 도구(tool)만 제공해요(파일 수정은 별도 액션으로 분리)

## 환경변수(environment variable)

- 로컬 개발은 `.env`를 허용해요(`.env.example` 참고)
- 코드에서 환경변수 로딩은 `@ailss/core/src/env.ts`의 `loadEnv()`를 통해 통일해요
- 필수 값이 없으면 “다음 행동이 가능한” 오류 메시지를 던져요(예: 어떤 env를 설정해야 하는지)

## 파일/모듈 규칙

- 파일명(file name)은 소문자(lowercase)를 기본으로 하고, 필요하면 하이픈(hyphen)을 써요
- ESM import/export만 사용해요(`require` 금지)
- 패키지 외부에서 쓰는 심볼(symbol)은 `packages/*/src/index.ts` 또는 명시적 엔트리(entry)로 노출해요

## 주석(comment) 규칙

- 주석은 “명사형”의 짧은 한국어로 써요(예: `// DB 스키마 마이그레이션`)
- 설명이 길어질 때는 주석 대신 문서(`docs/`)로 옮겨요

## 에러/로그 규칙

- CLI(indexer)는 `console.log`로 진행 상황을 출력해도 돼요
- 서버(mcp)는 입력 검증에 실패하면 명확한 에러를 반환해요
- 에러 메시지는 “원인 + 해결 방법” 순서로 작성해요

## 포맷/린트/테스트

- 포맷(format)은 Prettier를 기준으로 하고, lint는 ESLint로 처리해요
- 빠른 통합 체크는 `pnpm check`를 기본으로 해요
- 네트워크 의존(예: OpenAI 호출)은 테스트에서 직접 실행하지 말고, 인터페이스 주입(injection) 또는 목(mock)으로 분리해요
  - 상세 운영: `docs/standards/quality-gates.md`

## 보안/프라이버시 기본값

- vault 경로(path)는 외부 설정으로 받고, 경로 탈출(path traversal)을 방지해요
- MCP 서버는 기본적으로 파일 쓰기(write)를 하지 않아요
- API 키(key)는 코드/레포에 커밋하지 않아요(`.env`는 `.gitignore`)
