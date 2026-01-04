# Current context

This document pins down the current context: **why this repo exists** and **what we are building**.

## Background

- Target: Obsidian vault **AILSS**
- Goal: Use the OpenAI API to generate document embeddings, run semantic search, and connect the workflow through to organize/recommend/apply based on the vault README/AGENTS rules.
- Surface area: Provide tools through an MCP (Model Context Protocol) server so they can be called directly from Codex CLI.
- UI: Also surface recommendations in an Obsidian plugin, and only apply changes via explicit user actions.

## Current status (based on description)

The items below are recorded based on the **user-provided description** (they are not automatically verified by this repo).

- At the vault root there are `README.md` (frontmatter schema/layer/typed links definitions) and `AGENTS.md` (working rules).
- Under `0. System/Scripts` there are already automation scripts based on the Obsidian Local REST API (e.g., frontmatter insertion, batch apply).

This repo keeps a snapshot of the vault rule documents under `docs/vault-ref/` for reference.

## What this repo is for

This folder (`…/AILSS`) is **not** the Obsidian vault itself. It is a workspace for developing and maintaining:

- indexer code
- MCP server code
- Obsidian plugin code
- design/ops documentation

## Scope principles

- Default: separate “recommendation” (read-focused) from “apply” (explicit write).
- Safety: outbound data scope (privacy) and API key handling are treated explicitly in the design.
