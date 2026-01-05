# AGENTS.md — AILSS Global Working Rules

This file contains global rules for the repository root.

- Vault rules snapshot scope: `docs/vault-ref/vault-root/AGENTS.md` (applies only to that directory subtree)

---

## 0. Fixed opening line

**“Break down every request with `sequentialthinking`, and when `nextThoughtNeeded=false`, proceed immediately to the execution step within the same turn unless the user asks you to stop.”**

---

## 1. Documentation/context entrypoints

When starting work (as needed), check these docs first:

1. Documentation index: `docs/README.md`
2. Core flow: `docs/00-context.md` → `docs/01-overview.md` → `docs/02-significance.md` → `docs/03-plan.md`
3. Standards: `docs/standards/coding.md`, `docs/standards/commits.md`, `docs/standards/quality-gates.md`
4. Architecture/ops: `docs/architecture/*`, `docs/ops/*`, `docs/adr/*`
5. Vault rule snapshot: `docs/vault-ref/README.md` (vault-only rules are in `docs/vault-ref/vault-root/AGENTS.md`)

---

## 2. Required conventions: project

### 2.1 Runtime / package manager

- Node.js `>=20` (`package.json#engines`)
- pnpm `pnpm@10.20.0` (`package.json#packageManager`)
- pnpm workspace: `packages/*` (`pnpm-workspace.yaml`)

### 2.2 Install/build: local / sandbox

- Native module `better-sqlite3` may require a build.
- In sandbox/CI environments, default cache paths may be blocked, so pin caches inside the workspace.
  - Reference: `docs/ops/local-dev.md`
  - Recommended commands:
    - `CI=0 npm_config_cache="$PWD/.npm-cache" npm_config_devdir="$PWD/.node-gyp" pnpm install --no-frozen-lockfile`
    - `pnpm build`

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
- MCP server provides read-only tools by default (file writes are a separate explicit action)
- Vault path comes from external config; guard against path traversal

### 2.6 Supply-chain security: pnpm

- Only allow build scripts for dependencies listed in `pnpm-workspace.yaml#onlyBuiltDependencies`
- If adding a new native/build-script dependency, update `onlyBuiltDependencies`

### 2.7 Commit conventions (reference)

This repo recommends Conventional Commits.

- Format: `<type>(<scope>): <subject>`
- Details: `docs/standards/commits.md`
- **Agent rule (must follow)**: before drafting a commit message, check `commitlint.config.cjs` (source of truth) and use only allowed scopes.
  - Allowed scopes: `monorepo`, `core`, `indexer`, `mcp`, `plugin`, `docs`, `ops`
  - Example mapping: changes under `packages/obsidian-plugin/*` → scope `plugin` (not `obsidian-plugin`)
  - If a change spans multiple areas and you’re making a single commit, default scope to `monorepo` unless the user asks to split commits

---

## 3. Agent working rules: accuracy / scope

- Priority: accuracy > completeness > speed
- No guessing: if uncertain, verify via files/tools; resolve impactful ambiguity with 1–3 clarifying questions
- Scope discipline: do exactly what the user asked (no extra features/styling changes)
- Root-cause fixes: prefer fixing the root cause over workarounds
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
  - Vault rule changes: refresh `docs/vault-ref/vault-root/{README.md,AGENTS.md}` snapshots (keep them as close to verbatim as possible)
- Commit message drafting (required): after completing a job, draft a Conventional Commit message that matches `commitlint.config.cjs` (type + allowed scope), and include it in the final response
- Destructive actions (delete/reset/rollback) require prior notice

---

## 4. Tooling rules (required)

- Start every request with `sequentialthinking`
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
