# Quality gates

This document defines quality gates for building “solid and safe” changes in AILSS across three layers: **local → hooks → CI**.

The two core principles are:

1. **Hooks are fast**: run minimal checks focused on changed/staged files so they don’t block the dev flow.
2. **CI is strict**: run the full suite (release-candidate standard) in a reproducible way.

---

## 1) Local: developer-run commands

These are the default tools to quickly validate your changes.

### Format — Prettier

- Apply formatting: `pnpm format`
- Check formatting only: `pnpm format:check`

### Lint — ESLint

- Lint check: `pnpm lint`
- Lint with auto-fix: `pnpm lint:fix`

### Typecheck — TypeScript

- Package-level typecheck: `pnpm typecheck` (`pnpm -r typecheck`)
- Repo-wide typecheck (including tests): `pnpm typecheck:repo`

### Test — Vitest

- Run tests: `pnpm test`
- Watch mode: `pnpm test:watch`

### Integrated check

- Local quality gate: `pnpm check`
- CI quality gate: `pnpm check:ci` (local checks + build)

---

## 2) Hooks: automatic git-stage gates

This repo uses Lefthook.

- Config: `lefthook.yml`
- Install: automatically installed by the `prepare` script during `pnpm install`

### pre-commit (fast)

Goals:

- Remove formatting/lint mistakes before commit
- Run only on **staged** files

Actions:

- Prettier: run `--write` on staged files + re-stage (`stage_fixed`)
- ESLint: run `--fix` on staged TS files + re-stage (`stage_fixed`)

### commit-msg (strict)

Goal:

- Enforce commit message format defined in `docs/standards/commits.md`

Actions:

- Validate `<type>(<scope>): <subject>` via commitlint
- Restrict type/scope to the allowed list

### pre-push (heavier)

Goal:

- Add a final safety net before pushing to remote

Action:

- Run `pnpm check` (format check + lint + typecheck + tests)

---

## 3) CI: always strict and repo-wide

To reduce “works only on my machine” situations, CI pins:

- Node.js: `>=20` (CI uses Node 20)
- Package manager: pnpm `10.20.0`
- Hook installation disabled: CI uses `LEFTHOOK=0` to avoid modifying `.git/hooks`

Workflow:

- GitHub Actions: `.github/workflows/ci.yml`
- Secret scan: `gitleaks`
- Commit message lint: `commitlint` (PR commit range / push commit range)
- Quality gate: `pnpm check:ci`

---

## 4) Isolating network-dependent tests (important)

This project includes operations that are networked + paid + non-deterministic (e.g., OpenAI API calls).
To keep testing safe:

### Core rules

- Default tests must pass **without network** (both local and CI)
- Do not call OpenAI directly in tests; isolate via interface injection or mocks

### Suggested test suite split

- Offline unit tests: default `pnpm test`
- Online integration tests: separate file pattern, and skip if env is missing

Example patterns:

- `*.test.ts`: offline tests
- `*.openai.test.ts`: only runs when `OPENAI_API_KEY` is set (excluded from default CI)

> This split keeps hooks fast and CI strict, while still allowing opt-in online validation when needed.
