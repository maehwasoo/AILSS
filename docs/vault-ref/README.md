# Vault rules snapshot (`vault-ref`)

This folder stores a snapshot of the Obsidian AILSS vault’s **rule documents (source of truth)** so they can be referenced from this repo (code/design).

## Purpose

- Make it easy to reference vault rules (frontmatter schema, ontology, working rules) while developing in this repo.
- Reduce drift by separating “implementation specs” from “original rule documents”.

## Snapshot location

Copy the vault root files into the paths below (prefer keeping them verbatim):

- `docs/vault-ref/vault-root/README.md`
- `docs/vault-ref/vault-root/AGENTS.md`

> This repo should not contain the full Obsidian vault. The default is to snapshot only these two rule documents.

## Sync rules

- The source of truth always lives in the vault: `~/Obsidian/AILSS/README.md`, `~/Obsidian/AILSS/AGENTS.md`
- Files under `docs/vault-ref/` are reference snapshots.
- When updating: copy the originals → review changes via git diff → update implementation specs/code as needed.
