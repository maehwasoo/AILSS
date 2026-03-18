# Architecture: Python parity for the current MCP tool surface

This document defines the parity boundary tracked by issue #182.

It does not claim that the current Python backend already replaces the Node/MCP runtime.
Instead, it records which MCP behaviors must match before any later migration removes the
existing Node path, which differences are acceptable during the current baseline, and which
tools remain explicit gaps.

## Terms

- Exact-match parity: behavior, safety constraints, and failure semantics must stay aligned
  with the current MCP contract before the Node path can be removed.
- Acceptable baseline difference: a documented difference that is allowed while the Node/MCP
  path remains the source of truth for that capability.
- Gap / Node-only: there is no public Python replacement yet; the current MCP tool must stay
  on the Node path.

## Current parity boundary

- Python-covered now:
  - `/retrieve` is the Python-side parity target for `get_context`-style retrieval behavior.
  - `/agent/run` is the Python-side parity target for grounded-answer behavior and explicit
    write refusal semantics.
- Still Node-owned now:
  - MCP transport, indexer ownership, filesystem read tools, graph/navigation tools,
    metadata/list tools, diagnostics tools, and all explicit write tools.
- Migration gate:
  - Do not remove the Node/TypeScript path until every `Gap / Node-only` row below has an
    exact-match Python replacement or an explicitly accepted new contract.

## Read tool parity matrix

| Tool                          | Current Python target                                   | Status          | Exact-match requirements before migration                                                                                                                                                 | Acceptable baseline differences / current gap                                                                                                                         |
| ----------------------------- | ------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_context`                 | `/retrieve` and the retrieval stage inside `/agent/run` | Partial parity  | Preserve scoped candidate filtering (`path_prefix`, `tags_any`, `tags_all`), explicit readiness failures, grounded evidence, and no unrelated fallback when scope removes all candidates. | Response shape differs from MCP `structuredContent`; Python caps `top_k` at `20`; Python does not expose MCP-only fields such as `expand_top_k` or `applied_filters`. |
| `expand_typed_links_outgoing` | None                                                    | Gap / Node-only | Add a Python graph expansion contract that preserves bounded traversal semantics before migration.                                                                                        | No Python graph traversal API exists yet.                                                                                                                             |
| `resolve_note`                | None                                                    | Gap / Node-only | Add a Python note-resolution contract before migration.                                                                                                                                   | No Python resolution endpoint exists yet.                                                                                                                             |
| `find_typed_links_incoming`   | None                                                    | Gap / Node-only | Add a Python incoming-link query contract before migration.                                                                                                                               | No Python backref query exists yet.                                                                                                                                   |
| `list_typed_link_rels`        | None                                                    | Gap / Node-only | Add a Python relation-listing contract before migration.                                                                                                                                  | No Python typed-link relation listing exists yet.                                                                                                                     |
| `read_note`                   | Internal note reads inside `/agent/run` only            | Gap / Node-only | Add a public Python note-read contract with the current vault-boundary guarantees before migration.                                                                                       | The current Python backend only reads note excerpts internally; it does not expose the public pagination/change-token contract of `read_note`.                        |
| `get_vault_tree`              | None                                                    | Gap / Node-only | Add a Python vault-tree contract before migration.                                                                                                                                        | No Python vault-tree API exists yet.                                                                                                                                  |
| `frontmatter_validate`        | None                                                    | Gap / Node-only | Add a Python validator contract that preserves the current schema and typed-link diagnostic expectations before migration.                                                                | No Python frontmatter validation API exists yet.                                                                                                                      |
| `find_broken_links`           | None                                                    | Gap / Node-only | Add a Python broken-link diagnostic contract before migration.                                                                                                                            | No Python broken-link diagnostic API exists yet.                                                                                                                      |
| `search_notes`                | None                                                    | Gap / Node-only | Add a Python metadata-search contract before migration.                                                                                                                                   | No Python metadata-search API exists yet.                                                                                                                             |
| `list_tags`                   | None                                                    | Gap / Node-only | Add a Python tag-listing contract before migration.                                                                                                                                       | No Python tag-listing API exists yet.                                                                                                                                 |
| `list_keywords`               | None                                                    | Gap / Node-only | Add a Python keyword-listing contract before migration.                                                                                                                                   | No Python keyword-listing API exists yet.                                                                                                                             |
| `get_tool_failure_report`     | None                                                    | Gap / Node-only | Add a Python diagnostics-report contract before migration.                                                                                                                                | No Python diagnostics-report API exists yet.                                                                                                                          |

## Write tool parity matrix

| Tool                       | Current Python target          | Status          | Exact-match requirements before migration                                                                        | Acceptable baseline differences / current gap                                                       |
| -------------------------- | ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `capture_note`             | `/agent/run` refusal path only | Gap / Node-only | Preserve explicit `apply` gating and current vault-write safety before any Python write path replaces this tool. | The current Python baseline never creates notes. It only returns explicit refusal semantics.        |
| `canonicalize_typed_links` | `/agent/run` refusal path only | Gap / Node-only | Preserve explicit `apply` gating and safe deterministic mutation rules before migration.                         | The current Python baseline never rewrites typed links. It only returns explicit refusal semantics. |
| `edit_note`                | `/agent/run` refusal path only | Gap / Node-only | Preserve explicit `apply` gating, concurrency guards, and vault-boundary safety before migration.                | The current Python baseline never edits notes. It only returns explicit refusal semantics.          |
| `improve_frontmatter`      | `/agent/run` refusal path only | Gap / Node-only | Preserve explicit `apply` gating and current frontmatter safety rules before migration.                          | The current Python baseline never mutates frontmatter. It only returns explicit refusal semantics.  |
| `relocate_note`            | `/agent/run` refusal path only | Gap / Node-only | Preserve explicit `apply` gating and current path safety rules before migration.                                 | The current Python baseline never moves notes. It only returns explicit refusal semantics.          |

## Safety invariants that must not regress

- Vault boundary: Python note reads must stay within `AILSS_VAULT_PATH`; path traversal or
  absolute-escape attempts must not read outside the configured vault.
- Write gating: requested writes must fail explicitly unless the future Python path has an
  approved replacement for the current MCP write contract.
- Failure visibility: missing or invalid local prerequisites must fail explicitly rather than
  silently degrading to unrelated retrieval results.
- Grounding: Python-generated answers must keep inspectable citations; missing evidence is a
  failure, not a best-effort answer.

## Required failure codes for Python-covered agent flows

- `missing_context`
- `ambiguous_note_resolution`
- `grounding_failure`
- `write_not_allowed`
- `apply_not_requested`

## Verification currently in repo

- `packages/mcp/test/docs.mcpToolingConsistency.test.ts`
  - Keeps this parity matrix aligned with the live MCP tool surface.
- `apps/api/tests/test_parity_contract.py`
  - Verifies the documented Python parity-critical behaviors that already exist in the
    baseline.
- Existing Python route/unit coverage:
  - `apps/api/tests/test_retrieve.py`
  - `apps/api/tests/test_agent.py`
