# Architecture: removal of the legacy Node/TypeScript runtime path

This document records the removal completed for issues #179 and #181.

## What was removed

- `packages/mcp`
- `packages/indexer`
- Plugin default launch paths that depended on `node packages/mcp/dist/*.js`
- Plugin default launch paths that depended on `node packages/indexer/dist/cli.js`
- Release bundle staging that required `pnpm install --prod` for Node MCP/indexer packages

## What replaced it

- `apps/api/src/ailss_api/mcp_cli.py` (`ailss-mcp-http`) now owns the localhost MCP surface
- `apps/api/src/ailss_api/indexer_cli.py` (`ailss-indexer`) now owns index build/update/reset
- `apps/api/src/ailss_api/mcp_runtime.py` now owns the public read/write MCP tool contract
- The Obsidian plugin defaults to `uv run --directory <apps/api> ...` for backend, MCP, and indexer processes
- The release bundle now ships `ailss-service/apps/api` as the service payload

## Safety invariants preserved

- Vault boundary checks stay inside `AILSS_VAULT_PATH`
- Write tools stay gated behind `AILSS_ENABLE_WRITE_TOOLS=1` and `apply=true`
- Index/model mismatch checks stay enforced by the Python index DB owner path
- Reindex-after-write remains explicit and visible in tool responses
- MCP failure diagnostics remain persisted under `<vault>/.ailss/logs`

## Verification in repo

- `apps/api/tests/test_mcp_runtime.py`
  - Verifies the full Python MCP tool surface and representative read/write flows
- `apps/api/tests/test_parity_contract.py`
  - Verifies parity-critical Python behavior already documented for retrieval/agent flows
- `packages/obsidian-plugin/test/utils/pluginPaths.test.ts`
  - Verifies default command/arg resolution now points to `apps/api`
- `packages/obsidian-plugin/test/mcp/mcpHttpServiceController.startupHelpers.test.ts`
  - Verifies plugin startup guidance now expects Python MCP args

## Operational result

- Obsidian remains the UX shell and process supervisor
- Python owns indexing, MCP, retrieval, agent execution, and eval
- The retired Node runtime path is no longer shipped, launched, or documented as an active option
