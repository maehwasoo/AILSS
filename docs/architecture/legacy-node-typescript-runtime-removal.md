# Architecture: staged removal of the legacy Node/TypeScript runtime path

This document defines the removal boundary tracked by issue #181.

It is a sequencing plan, not approval to remove the current Node/TypeScript runtime today.
The transition path remains required until the compatibility gates below are explicitly
verified.

## Scope and relationship to other issues

- Baseline umbrella: issue #175
- Later-phase migration umbrella: issue #179
- Related prerequisites:
  - issue #180: re-center the Obsidian plugin around the Python backend runtime
  - issue #182: verify Python parity for the current MCP read/write tool surface
- Non-goal:
  - removing the current Node/TypeScript transition path before parity and plugin-runtime
    verification are complete

## Transitional-only runtime paths

| Path / surface                                                                                        | Current role                                                   | Why it still exists                                                                                          | Removal gate                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/indexer` and `packages/obsidian-plugin/src/indexer/*`                                       | Local index build/update/reset owner                           | The Python backend currently reuses the existing SQLite index instead of replacing index maintenance.        | Remove only after a verified non-Node index-maintenance path preserves DB identity checks, scoped reindex behavior, and reset/log troubleshooting flows. |
| `packages/mcp` and `packages/obsidian-plugin/src/mcp/*`                                               | MCP transport and explicit/gated write-tool owner              | The Python backend does not yet expose the full public MCP-equivalent read/write contract.                   | Remove only after issue #182 parity work and the replacement transport contract are both verified.                                                       |
| Node launch/config settings in the plugin (`indexerCommand`, `indexerArgs`, MCP service command/args) | Plugin compatibility layer for the current transition services | The plugin still has to start the Node-owned indexer and MCP paths in source-build and release-bundle flows. | Remove only after the underlying transition service is removed and the plugin has a verified replacement owner.                                          |
| Docs, release-bundle notes, and troubleshooting steps that mention Node commands or scripts           | User guidance for the current transition baseline              | Users still need accurate setup and failure guidance while the transition path is live.                      | Remove or rewrite in the same PR as the runtime deletion so docs never describe a removed path as active.                                                |

## Compatibility gates

1. MCP parity gate (#182)
   - Every Node-owned MCP behavior is either replaced with an exact-match Python contract or
     explicitly accepted as a new contract.
   - Safety invariants stay aligned:
     - vault-boundary enforcement
     - explicit write gating
     - fail-fast prerequisite checks
     - grounded, inspectable evidence
2. Plugin-runtime gate (#180)
   - The plugin's primary startup, status, and troubleshooting flow is centered on the
     Python backend.
   - Remaining Node surfaces are clearly labeled as transition-only compatibility paths.
3. Index-maintenance gate
   - The repo has a verified owner for DB build/update/reset behavior before the Node
     indexer path is removed.
   - Existing embedding-model mismatch protection and scoped reindex behavior must remain.
4. Packaging and docs gate
   - Release bundles, local-dev docs, and troubleshooting copy stop presenting any removed
     Node path as an active runtime option.
   - Removed paths fail fast with explicit configuration/startup errors; they do not silently
     fall back to an unverified replacement.

## Required removal order

1. Mark transition-only boundaries in docs and plugin-facing copy.
   - This issue defines that boundary so later work does not mix parity verification, plugin
     runtime changes, and code deletion in one step.
2. Finish MCP parity verification while the current Node MCP path remains the source of
   truth.
   - Keep `packages/mcp` and plugin MCP launch/config active until the parity gate is
     complete.
3. Re-center the plugin around the Python backend runtime.
   - Keep Node services secondary and explicitly transitional in plugin settings, status, and
     troubleshooting flows.
4. Remove the Node MCP launch path and `packages/mcp` together.
   - Do this only after parity and replacement transport verification are complete in the
     same reviewable change set.
5. Remove the Node indexer launch path and `packages/indexer` last.
   - Do this only after a verified replacement owns index build/update/reset behavior
     without weakening the current DB safety model.
6. Remove stale docs, release-bundle references, and troubleshooting steps with each runtime
   deletion.
   - Do not leave removed paths described as supported after code deletion lands.

## Deprecation markers for the interim

- Use `transition layer` or `transition component` when referring to the Node indexer and
  MCP service in docs and plugin-facing copy.
- Do not describe the Node services as the primary local runtime.
- Do not add new product-scope runtime features to the Node transition path unless they are
  required to preserve compatibility or safety during migration.
- Prefer fail-fast behavior over implicit fallback when a transition path is retired.
