# AGENTS.md (packages/indexer)

## What this folder is

`@ailss/indexer` is the **CLI** that indexes an Obsidian vault for AILSS.

## What it does

- Parses CLI flags/args and kicks off indexing runs
- Uses `@ailss/core` for vault parsing and DB access
- Uses the OpenAI SDK for embedding/indexing workflows

## Entry points

- CLI entry: `packages/indexer/src/cli.ts`
- Indexing logic: `packages/indexer/src/indexVault.ts`

## What to follow

- Keep dependency direction: `@ailss/indexer` should depend only on `@ailss/core` (plus external deps).
- CLI behavior (flags, default paths, exit codes) is a user-facing contract — update docs when it changes.

## Conventions

- Keep the CLI layer thin: validate input, call shared logic, handle errors/exit codes centrally.
- Move reusable logic into `@ailss/core` instead of duplicating it in the CLI.
