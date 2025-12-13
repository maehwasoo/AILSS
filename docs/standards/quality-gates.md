# 품질 게이트(quality gate)

이 문서는 AILSS에서 “탄탄하고 안전한” 개발을 위해 품질 게이트(quality gate)를 **로컬(local) → 훅(hook) → CI(지속적 통합, continuous integration)** 3계층으로 운영하는 규칙을 정의해요.

핵심 원칙은 아래 2가지예요.

1. **훅(hook)은 빠르게**: 개발 흐름(flow)을 방해하지 않게 “변경된 것 중심”으로 최소 비용으로 돌려요.
2. **CI는 엄격하게**: 전체(release candidate) 기준으로 동일한 검증을 반복 가능(reproducible)하게 돌려요.

---

## 1) 로컬(local): 개발자가 직접 실행하는 커맨드

> “내 코드가 괜찮은지”를 빠르게 확인하는 기본 도구 세트예요.

### 포맷(format) — Prettier

- 전체 포맷 적용: `pnpm format`
- 포맷 체크만: `pnpm format:check`

### 린트(lint) — ESLint

- 린트 체크: `pnpm lint`
- 자동 수정 포함: `pnpm lint:fix`

### 타입 검사(typecheck) — TypeScript

- 패키지 단위 타입 검사: `pnpm typecheck` (`pnpm -r typecheck`)
- 레포 전체 타입 검사(테스트 포함): `pnpm typecheck:repo`

### 테스트(test) — Vitest

- 테스트 실행: `pnpm test`
- 감시 모드(watch mode): `pnpm test:watch`

### 통합 체크(check)

- 로컬 품질 게이트: `pnpm check`
- CI 품질 게이트: `pnpm check:ci` (로컬 체크 + 빌드(build)까지)

---

## 2) 훅(hook): git 단계별 자동 게이트

이 레포는 Lefthook을 사용해요.

- 설정 파일: `lefthook.yml`
- 설치(install): `pnpm install` 시 `prepare` 스크립트로 자동 설치돼요

### pre-commit (빠르게)

목표:

- 커밋 직전에 “형식/실수”를 빠르게 제거해요
- **staged 파일만** 대상으로 실행해요

동작:

- Prettier: staged 파일에 `--write` 적용 + 재스테이징(stage_fixed)
- ESLint: staged TS 파일에 `--fix` 적용 + 재스테이징(stage_fixed)

### commit-msg (정확하게)

목표:

- 커밋 메시지가 `docs/standards/commits.md`를 따르도록 강제해요

동작:

- commitlint로 `<type>(<scope>): <subject>` 형식을 검증해요
- scope/type은 레포에서 허용한 목록으로 제한해요

### pre-push (상대적으로 무겁게)

목표:

- 원격(remote)으로 보내기 전에, 최소한의 안전망을 한 번 더 통과해요

동작:

- `pnpm check` 실행(포맷 체크 + 린트 + 타입 검사 + 테스트)

---

## 3) CI(지속적 통합): 항상 전체 기준으로 엄격하게

CI는 “내 컴퓨터에서만 되는” 상황을 줄이기 위해 아래를 고정해요.

- Node.js 버전: `>=20` (CI에서는 20 사용)
- 패키지 매니저: pnpm `10.20.0`
- 훅 설치 비활성화: CI에서는 `LEFTHOOK=0`로 `.git/hooks` 변경을 하지 않아요

워크플로우(workflow):

- GitHub Actions: `.github/workflows/ci.yml`
- 실행 커맨드(command): `pnpm check:ci`

---

## 4) 네트워크 의존 테스트 격리(중요)

이 프로젝트는 OpenAI API 호출처럼 네트워크(network) + 비용(cost) + 비결정성(nondeterminism)이 섞인 작업이 있어요.
그래서 테스트는 아래 원칙을 지켜야 안전해요.

### 기본 원칙

- 기본 테스트는 **네트워크 없이** 통과해야 해요(로컬/CI 공통)
- OpenAI 호출은 테스트에서 직접 실행하지 말고, 인터페이스(interface) 주입(injection) 또는 목(mock)으로 분리해요

### 파일/스위트 분리(권장)

- 오프라인 단위 테스트(unit test): 기본 `pnpm test` 대상
- 온라인 통합 테스트(integration test): 별도 파일 패턴으로 분리하고, env가 없으면 스킵(skip)해요

예시 패턴:

- `*.test.ts`: 기본 오프라인 테스트
- `*.openai.test.ts`: `OPENAI_API_KEY`가 있을 때만 동작하는 테스트(기본 CI에서는 제외)

> 이 분리는 “훅은 빠르게, CI는 엄격하게”를 지키면서도, 필요할 때만 온라인 검증을 켤 수 있게 해줘요.
