# AGENTS.md (docs/ops)

## What this folder is

This folder contains **runbooks and operational docs** for developing and running AILSS.

## Entry points

- Local dev: `docs/ops/local-dev.md`
- Codex CLI: `docs/ops/codex-cli.md`

## What to follow

- Treat these docs as the source of truth for **how to run/build** the repo (flags, env vars, sandbox notes).
- If a workflow changes (install steps, sandbox requirements, build outputs), update the relevant doc here.

## Conventions

- Prefer linking to the authoritative doc page over copying long command blocks into other files.
- When you do add commands to docs, include prerequisites (Node/pnpm versions) and sandbox caveats.
