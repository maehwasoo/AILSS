# Architecture: Python parity for the MCP tool surface

This document records the Python-owned MCP surface after the parity work tracked by #182 and
the runtime removal tracked by #179 / #181.

## Current Python MCP surface

Source of truth: `apps/api/src/ailss_api/mcp_runtime.py`.

Read tools:

- `get_context`
- `resolve_note`
- `search_notes`
- `list_tags`
- `list_keywords`
- `list_typed_link_rels`
- `find_typed_links_incoming`
- `expand_typed_links_outgoing`
- `find_broken_links`
- `read_note`
- `get_vault_tree`
- `frontmatter_validate`
- `get_tool_failure_report`

Write tools (registered only when `AILSS_ENABLE_WRITE_TOOLS=1`):

- `capture_note`
- `edit_note`
- `improve_frontmatter`
- `relocate_note`
- `canonicalize_typed_links`

## Required safety invariants

- Vault boundary enforcement for all filesystem-backed reads and writes
- Explicit write gating through environment opt-in and `apply=true`
- Fail-fast prerequisite checks for vault path, DB path, and API key configuration
- Grounded retrieval/agent behavior with inspectable evidence
- Reindex visibility in every write-tool response

## Required failure codes for Python-covered agent flows

- `ambiguous_note_resolution`
- `apply_not_requested`
- `grounding_failure`
- `missing_context`
- `write_not_allowed`

## Verification currently in repo

- `apps/api/tests/test_mcp_runtime.py`
  - Verifies the full registered tool set and representative read/write flows on the Python owner path
- `apps/api/tests/test_parity_contract.py`
  - Verifies parity-critical retrieval and agent refusal behavior
- `apps/api/tests/test_retrieve.py`
  - Verifies retrieval readiness, lexical fallback behavior, and semantic search behavior
- `packages/obsidian-plugin/test/utils/pluginPaths.test.ts`
  - Verifies the plugin resolves Python MCP/indexer/backend runners from `apps/api`

## Result

The public MCP contract is now owned by Python. The repo no longer keeps a separate
Node/TypeScript MCP runtime path for parity coverage.
