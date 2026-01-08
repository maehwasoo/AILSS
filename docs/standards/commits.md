# Commit conventions

This document defines commit message rules for this repo.

## Goals

- Make change history easy to understand
- Make package-level scope clear
- Keep the door open for automated release notes

## Format

We follow Conventional Commits and standardize on:

```
<type>(<scope>): <subject>
```

Examples:

- `feat(monorepo): scaffold core/db + indexer + mcp stdio`
- `feat(docs): document vault rules (frontmatter + typed links)`

## `type` rules

- `feat`: user-facing feature
- `fix`: bug fix
- `docs`: documentation-only change
- `refactor`: refactor with no behavior change
- `test`: add/update tests
- `chore`: non-feature work (build/cleanup/scripts, etc.)
- `build`: build system/dependency changes
- `ci`: CI config changes
- `perf`: performance improvement
- `revert`: revert

## `scope` rules

Scope expresses where the change happened. Prefer one of:

- `monorepo`: workspace-level config (root tsconfig, lockfile, etc.)
- `core`: `packages/core`
- `indexer`: `packages/indexer`
- `mcp`: `packages/mcp`
- `plugin`: `packages/obsidian-plugin`
- `docs`: `docs/*`
- `ops`: local runbook docs or ops scripts

Notes:

- Scope is required in this repo (enforced by commitlint).
- Prefer the smallest scope that matches where the change lives.
- If a change spans multiple scopes, prefer splitting into multiple commits.
- Use `monorepo` only when the change is inherently cross-cutting or repo-level (e.g. CI/workflows, root config, shared tooling), or when it cannot be reasonably split.

Examples:

- `ci(monorepo): tighten workflow permissions`
- `build(monorepo): bump pnpm version`
- `docs(ops): document indexer reset flow`

## `subject` rules

- Summarize in one line and omit the trailing period
- English is preferred (Korean is acceptable when needed), but keep terminology consistent
- Make it obvious what changed (put the “why” in a PR description, an issue, or docs/ADRs)
- Include file paths or specific names only when helpful

## Body policy

Commit messages in this repo are **single-line only**.

- Do not add a body, footers, or trailers (e.g., `Signed-off-by:`)
- Put extra context in a PR description, an issue, or docs/ADRs instead

## Automated validation (hook)

This repo validates commit messages via commitlint in the `commit-msg` hook.

- Config: `commitlint.config.cjs`
- Hook: `lefthook.yml`
