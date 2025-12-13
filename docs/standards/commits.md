# 커밋 컨벤션(commit convention)

이 문서는 이 repo의 커밋 메시지(commit message) 규칙을 정의해요.

## 목표

- 변경 이력을 빠르게 이해할 수 있게 해요
- 패키지(package) 단위 변경 범위를 명확히 해요
- 나중에 릴리스 노트(release note) 자동화 가능성을 열어둬요

## 형식(format)

기본 형식은 Conventional Commits를 따르고, 아래를 고정해요.

```
<type>(<scope>): <subject>
```

예:

- `feat(monorepo): core/db + indexer + mcp stdio 스캐폴딩`
- `feat(docs): vault 규칙 원문(vault-ref) 스냅샷 구조 추가`

## type 규칙

- `feat`: 사용자 가치가 있는 기능 추가
- `fix`: 버그 수정
- `docs`: 문서만 변경
- `refactor`: 기능 변경 없는 리팩터링(refactor)
- `test`: 테스트 추가/수정
- `chore`: 잡무(빌드/정리/스크립트 등), 기능/버그와 무관한 변경
- `build`: 빌드 시스템/의존성(dependencies) 변경
- `ci`: CI 설정 변경
- `perf`: 성능(performance) 개선
- `revert`: 리버트(revert)

## scope 규칙

scope는 “어디가 바뀌었는지”를 표현해요. 아래 목록에서 고르는 것을 기본으로 해요.

- `monorepo`: 루트 워크스페이스(workspace) 설정, 공용 tsconfig, 락파일(lockfile) 등
- `core`: `packages/core`
- `indexer`: `packages/indexer`
- `mcp`: `packages/mcp`
- `plugin`: `packages/obsidian-plugin`
- `docs`: `docs/*`
- `ops`: 로컬 실행/운영(runbook) 문서 또는 운영 스크립트

scope를 고르기 애매하면 `monorepo` 또는 `docs`를 우선 사용해요.

## subject 규칙

- 한 줄로 요약하고, 마침표는 생략해요
- 한국어/영어 모두 가능하지만, 용어는 가능한 한 한영 병기해요
- “무엇을 바꿨는지”가 드러나게 써요(why는 body로)
- 파일 경로(path)나 구체 명칭은 필요할 때만 포함해요

## body(본문) 작성 기준

기본은 subject 한 줄로 충분해요. 아래에 해당하면 body를 추가해요.

- 설계/행동 변화가 있는 경우(예: DB 스키마 변경)
- 사용자에게 마이그레이션(migration)이 필요한 경우
- 보안/프라이버시(privacy) 관련 변경

Body 예시 템플릿:

```
Context:
- ...

Decision:
- ...

Notes:
- ...
```

## 자동 검증(hook)

이 레포는 commit-msg 훅(hook)에서 commitlint로 커밋 메시지를 검증해요.

- 설정: `commitlint.config.cjs`
- 훅: `lefthook.yml`
