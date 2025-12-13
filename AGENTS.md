# AGENTS.md — AILSS 전역 작업 규칙

이 파일은 저장소(repo) 루트(root) 기준 전역 규칙이에요.

- 볼트(vault) 원문 스냅샷 규칙: `docs/vault-ref/vault-root/AGENTS.md` (해당 디렉터리 하위 트리(tree)에만 적용돼요)

---

## 0. 시작 고정문

**“모든 요청은 `sequentialthinking`로 단계 분해하고, `nextThoughtNeeded=false`가 되면 사용자가 중단을 요청하지 않는 한 같은 턴에서 즉시 실행 단계로 이어가요.”**

---

## 1. 문서/컨텍스트 엔트리포인트(entrypoint)

작업 시작 시(필요한 범위에서) 아래 문서를 우선 확인해요.

1. 문서 인덱스(index): `docs/README.md`
2. 핵심 흐름(core flow): `docs/00-context.md` → `docs/01-overview.md` → `docs/02-significance.md` → `docs/03-plan.md`
3. 표준(standards): `docs/standards/coding.md`, `docs/standards/commits.md`, `docs/standards/quality-gates.md`
4. 설계/운영: `docs/architecture/*`, `docs/ops/*`, `docs/adr/*`
5. 볼트 규칙 스냅샷(snapshot): `docs/vault-ref/README.md` (볼트 자체에 적용할 규칙은 `docs/vault-ref/vault-root/AGENTS.md` 기준이에요)

---

## 2. 필수 컨벤션(convention): 프로젝트

### 2.1 런타임(runtime) / 패키지 매니저(package manager)

- Node.js `>=20` (`package.json#engines`)
- pnpm `pnpm@10.20.0` (`package.json#packageManager`)
- pnpm workspace: `packages/*` (`pnpm-workspace.yaml`)

### 2.2 설치/빌드(install/build): 로컬(local) / 샌드박스(sandbox)

- 네이티브 모듈(native module) `better-sqlite3` 빌드가 필요할 수 있어요.
- 샌드박스/CI 환경에서 캐시 경로가 막힐 수 있어서, 캐시를 workspace 내부로 고정하는 것을 기본으로 해요.
  - 기준 문서: `docs/ops/local-dev.md`
  - 권장 커맨드(command):
    - `CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile`
    - `pnpm build`

### 2.3 TypeScript / 모듈(module)

- TypeScript + ESM(ECMAScript Modules) 기반(`"type": "module"`)
- tsconfig는 `tsconfig.base.json`을 기준으로 하고, strict 모드를 유지해요
- 패키지별 빌드 산출물은 기본적으로 `dist/`를 사용해요

### 2.4 패키지 의존 방향(dependency direction)

- `@ailss/core`는 공용 로직만 포함해요(다른 패키지에 의존하지 않아요)
- `@ailss/indexer`, `@ailss/mcp`는 `@ailss/core`만 의존해요

### 2.5 환경변수(environment variable) / 보안(security)

- `.env`는 로컬 개발에서만 사용하고, 레포에 커밋하지 않아요(`.gitignore`)
- 환경변수 로딩은 `@ailss/core/src/env.ts`의 `loadEnv()`로 통일해요
- MCP 서버(server)는 기본적으로 읽기(read-only) 도구(tool)만 제공해요(파일 쓰기(write)는 별도 액션으로 분리해요)
- vault 경로(path)는 외부 설정으로 받고, 경로 탈출(path traversal)을 방지해요

### 2.6 공급망 보안(supply-chain security): pnpm

- `pnpm-workspace.yaml#onlyBuiltDependencies`에 허용된 의존성만 빌드 스크립트를 실행해요
- 새 네이티브/빌드 스크립트 의존성을 추가하면 `onlyBuiltDependencies` 갱신이 필요해요

### 2.7 커밋 컨벤션(commit convention) (참고)

커밋은 Conventional Commits 기반을 권장해요.

- 형식(format): `<type>(<scope>): <subject>`
- 상세: `docs/standards/commits.md`

---

## 3. 에이전트 작업 규칙(rules): 정확성/스코프

- 우선순위(priority): 정확성(accuracy) > 완성도(completeness) > 속도(speed)예요
- 추측 금지: 불확실하면 파일/도구로 검증하거나, 영향 큰 모호성(ambiguity)은 확인 질문 1–3개로 해소해요
- 스코프 규율(scope discipline): 사용자가 요청한 것만 수행해요(추가 기능/스타일 변경 금지)
- 근본 수정(root-cause fix): 가능하면 임시 해결(workaround) 대신 근본 원인을 해결해요
- 파괴적 작업(destructive action: 삭제/리셋/롤백)은 사전 고지 없이 진행하지 않아요

---

## 4. 도구 사용 규칙(tooling): 필수

- 모든 요청은 `sequentialthinking`부터 시작해요
- URL 원문 확인은 `fetch`를 우선 사용해요
- 독립적인 읽기 작업은 `multi_tool_use.parallel`로 병렬화(parallelize)해요
- 파일 수정은 `apply_patch`를 우선 사용해요

---

## 5. 출력 규격(output shape): 필수

- 기본 답변: 3–6문장 또는 ≤5개 불릿
- 복잡한 다단계/다파일 작업:
  - 1문단 요약(결론/방향)
  - 그 다음 ≤5개 불릿(What / Where / Risks / Next / Open)
- 모든 응답은 한국어로 제공하고 “~해요”체를 유지해요
- 기술 용어는 한국어 번역과 함께 영어 원문을 병기해요
