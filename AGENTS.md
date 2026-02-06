# AGENTS.md — AILSS Global Working Rules

This file contains global rules for the repository root.

---

## 1. Documentation/context entrypoints

When starting non-trivial work (multi-step, behavior change, or anything cross-package), check these docs first:

1. Documentation index: `docs/README.md`
2. Core flow: `docs/00-context.md` → `docs/01-overview.md` → `docs/02-significance.md` → `docs/03-plan.md`
3. Standards: `docs/standards/coding.md`, `docs/standards/commits.md`, `docs/standards/quality-gates.md`
4. Architecture/ops: `docs/architecture/*`, `docs/ops/*`, `docs/adr/*`
5. Vault rules (knowledge model): `docs/standards/vault/README.md`

### 1.1 Doc utilization checklist (task → docs)

Use this to “fully utilize” docs without loading unrelated context:

- First contact / unclear scope → `docs/README.md`, then `docs/00-context.md` → `docs/03-plan.md`
- CLI behavior/flags/indexer usage → `docs/01-overview.md`, `docs/ops/local-dev.md`
- Codex CLI sandbox/MCP startup/permissions → `docs/ops/codex-cli.md`, `docs/adr/0006-codex-cli-sandbox-vault-permissions.md`
- DB schema/index/search semantics → `docs/architecture/data-db.md`, `docs/adr/0005-db-migrations-and-embedding-dimensions.md`
- Package boundaries/entrypoints/deps → `docs/architecture/packages.md`, `docs/adr/0001-monorepo-packages.md`
- Obsidian plugin process model → `docs/adr/0003-obsidian-plugin-spawns-processes.md`
- Vault schema/rules (frontmatter/typed links) → `docs/standards/vault/README.md`

---

## 2. Required conventions: project

### 2.1 Runtime / package manager

- Node.js `>=20` (`package.json#engines`)
- pnpm `pnpm@10.20.0` (`package.json#packageManager`)
- pnpm workspace: `packages/*` (`pnpm-workspace.yaml`)
- Use **pnpm only** — do not commit npm/yarn lockfiles (e.g. `package-lock.json`, `yarn.lock`)

### 2.2 Install/build: local / sandbox

- Native module `better-sqlite3` may require a build.
- In sandbox/CI environments, default cache paths may be blocked, so pin caches inside the workspace.
  - Reference: `docs/ops/local-dev.md`
  - Recommendation: keep caches inside the repo workspace (see the doc for the exact commands/flags).

### 2.3 TypeScript / modules

- TypeScript + ESM (`"type": "module"`)
- Base tsconfig is `tsconfig.base.json`, and strict mode must remain enabled
- Package build output defaults to `dist/`

### 2.4 Dependency direction

- `@ailss/core` contains shared logic only (must not depend on other packages)
- `@ailss/indexer` and `@ailss/mcp` depend only on `@ailss/core`

### 2.5 Environment variables / security

- `.env` is local-dev only; do not commit (`.gitignore`)
- Centralize env loading via `@ailss/core/src/env.ts` `loadEnv()`
- MCP server provides read-only behavior by default:
  - Write tools require `AILSS_VAULT_PATH`
  - Write tools default to `apply=false` (dry-run) and only write when `apply=true`
- Vault path comes from external config; guard against path traversal

### 2.6 Supply-chain security: pnpm

- Only allow build scripts for dependencies listed in `pnpm-workspace.yaml#onlyBuiltDependencies`
- If adding a new native/build-script dependency, update `onlyBuiltDependencies`

### 2.7 Commit conventions (reference)

This repo enforces Conventional Commits (commitlint + Lefthook).

- Format: `<type>(<scope>): <subject>`
- Details: `docs/standards/commits.md`
- **Agent rule (must follow)**: before drafting a commit message, check `commitlint.config.cjs` (source of truth) and use only allowed scopes.
  - Allowed scopes: `monorepo`, `core`, `indexer`, `mcp`, `plugin`, `docs`, `ops`
  - Example mapping: changes under `packages/obsidian-plugin/*` → scope `plugin` (not `obsidian-plugin`)
  - If a change spans multiple areas, **default to splitting into multiple commits** with the tightest valid scope per commit; use `monorepo` only for inherently cross-cutting changes (or when the user explicitly wants a single commit)

### 2.8 Pull Request conventions (required)

- Title format: `<type>: <title>`
  - Allowed `type`: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `revert`
  - `<title>` must start with a lowercase letter (e.g. `feat: add ...`, not `feat: Add ...`)
  - Do not use Conventional Commit scopes in PR titles (no `type(scope): ...`) — scopes are for commit messages only.
- Body:
  - Default: use the existing template at `.github/pull_request_template.md` and replace all `[REPLACE ME]` placeholders.
  - Exception (version bump only): use this exact minimal format:
    - `Version bump only (service + plugin).`
    - `- After merge: tag v<version> on main to trigger release.`
- Language: PR title and body must be written in English.
- Sections (template-based PRs only): for each template section (`## What`, `## Why`, `## How`), write content as bullet points only (no prose paragraphs).
- Scope: the PR description must reflect _all_ changes in the branch (code + docs + tests).
- Testing:
  - Default: include the exact validation commands you ran (or explicitly state `Not run` and why).
  - Exception (version bump only): omit (body is fixed); rely on CI + pre-push checks.
- Issues: include `Fixes #...` when applicable; omit the line otherwise.

### 2.9 GitHub issue conventions (required)

When filing an issue, optimize for fast, high-confidence triage.

- Title: concise, specific, and action-oriented (avoid vague titles like “It doesn’t work”).
- Prefer using the Issue templates under `.github/ISSUE_TEMPLATE/` (they standardize title prefixes and required fields).
- Avoid encoding component or scope in the title (no `type(scope): ...` and no `component: ...` prefixes); use labels (and template fields when present) instead.
- Problem statement: what you were trying to do and why.
- Reproduction: numbered steps starting from a clean state; include minimal config/snippets when possible.
- Expected vs actual: explicit “Expected:” and “Actual:” sections.
- Evidence: exact error messages/stack traces; screenshots only when text is insufficient.
- Environment (redact secrets):
  - OS + version
  - Node + pnpm versions
  - Obsidian version (if plugin-related)
  - AILSS package versions (plugin/mcp/indexer/core) and how installed (release vs local build)
  - Relevant env vars (names + non-secret values), especially `AILSS_*` (never include tokens/keys)
- Component tagging: clearly state which component(s) are involved (`indexer`, `mcp`, `plugin`, `core`, `docs`).
- MCP HTTP issues: include HTTP status, endpoint/path, whether `Mcp-Session-Id` was present, and which `AILSS_MCP_HTTP_*` settings were used (token redacted).
- Proposed solution (optional): if you have a hypothesis or fix direction, add it as a separate bullet list.
- Security: if the issue involves secrets or an exploitable vulnerability, do **not** file a public issue; report privately.

### 2.10 GitHub labels (area labeler)

- Area labels (`plugin`, `mcp`, `indexer`, `core`, `docs`, `ops`) are auto-applied by the GitHub Actions labeler based on changed file paths.
  - Config: `.github/workflows/labeler.yml` + `.github/labeler.yml`
- Manually apply labels that are not path-derived (for example: `ignore-for-release`).

---

## 3. Agent working rules: accuracy / scope

- Priority: accuracy > completeness > speed
- No guessing: if uncertain, verify via files/tools; resolve impactful ambiguity with 1–3 clarifying questions
- Scope discipline: do exactly what the user asked (no extra features/styling changes)
- Root-cause fixes: prefer fixing the root cause over workarounds
- Refactoring guideline (not a hard rule):
  - Treat “~300–600 lines per file” as a **smell**, not a limit. Refactor when cohesion drops (multiple responsibilities), cognitive load rises (hard to explain), or changes require touching many unrelated sections.
  - Prefer smaller refactors that preserve behavior and are covered by tests; avoid “mega-refactors” mixed with feature work unless explicitly requested.
- Documentation is guidance, not a gate: do not get "locked" into existing docs/notes—when docs conflict with code/tests or the user’s intent, treat the implementation as source of truth and update docs to match.
- Documentation alignment (required): after completing a job, update the minimal set of docs needed to match the current implementation and avoid drift.
  - If you add a new doc under `docs/`, link it from `docs/README.md` so it stays discoverable
  - CLI/MCP surface changes (new/removed tools, tool args, result shapes): `docs/01-overview.md`, and `README.md` if user-facing
  - DB/indexing/schema changes: `docs/architecture/data-db.md`
  - Package boundaries/entrypoints/dependency direction: `docs/architecture/packages.md`
  - Plan/status/TODO changes: `docs/03-plan.md` (use this as the repo “TODO” tracker unless a dedicated TODO doc is introduced)
  - Scope/principles/context changes: `docs/00-context.md` and/or `docs/02-significance.md`
  - Dev/ops changes (install/build/env/runtime) and operational runbooks/logs: `docs/ops/local-dev.md` (or add a new file under `docs/ops/` and link it from `docs/README.md`)
  - New architectural decision or tradeoff: add/update an ADR in `docs/adr/` (use the template in `docs/adr/README.md`)
  - Vault rule changes: update `docs/standards/vault/README.md` and keep prompts/templates/validators aligned
- Commit message drafting (required): after completing a job, draft Conventional Commit message(s) that match `commitlint.config.cjs` (type + allowed scope); if the change spans multiple scopes, include a suggested commit breakdown (scope → files) and one message per commit
- Destructive actions (delete/reset/rollback) require prior notice

---

## 4. Tooling rules (required)

- For URL source text, prefer `fetch`
- Parallelize independent reads via `multi_tool_use.parallel`
- Prefer `apply_patch` for edits

---

## 5. Output shape (required)

- Default answers: 3–6 sentences or ≤5 bullets
- Complex multi-step/multi-file work:
  - 1-paragraph summary (conclusion/direction)
  - Then ≤5 bullets (What / Where / Risks / Next / Open questions)
- All responses must be in English
- For technical terms, include a short plain-English explanation on first use

---

## 6. Refactoring guidelines (required)

- Refactor only when it reduces risk or duplication for the current task; avoid “cleanup” refactors that expand scope.
- Prefer small, behavior-preserving extractions (helper functions/modules) over large rewrites; keep diffs easy to review.
- Treat line count as a signal, not a rule. Refactor when a file is hard to navigate (mixed concerns, repeated setup/teardown, long helpers) even if it’s <500 lines.
- Heuristics (non-binding): consider refactoring when a file exceeds ~500 lines, when helpers exceed ~150 lines, or when the same code block appears in 3+ places.
- Verification requirement: after refactoring, run the closest tests/lint/typecheck available and ensure no public API/CLI behavior changes unless explicitly requested.

---
