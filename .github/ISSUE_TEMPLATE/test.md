---
name: Test improvement (Markdown)
about: Add or improve tests without changing user-visible behavior (Markdown template)
title: "test: "
labels: ["test"]
---

Use this template for test-only improvements and regression coverage.
Please avoid adding component/scope to the title (no `test(mcp): ...`, no `plugin: ...`).
Use labels for component tagging instead.

## Component

Which area should be covered?

- [ ] Indexer (`packages/indexer`)
- [ ] MCP server (`packages/mcp`)
- [ ] Obsidian plugin (`packages/obsidian-plugin`)
- [ ] Core/shared (`packages/core`)
- [ ] Docs
- [ ] Ops/CI
- [ ] Multiple components

## Problem statement

What gap in test coverage or regression risk are you addressing?

## Test goal

What should become verifiable after this issue is done?

## In scope

What tests and files are included?

## Out of scope

What must stay unchanged? (for example: no runtime behavior change)

## Test strategy

- [ ] Unit tests
- [ ] Integration tests
- [ ] End-to-end tests
- [ ] Golden/snapshot contract tests

## Validation

Which checks/tests should pass?

## Done criteria

What defines completion?
