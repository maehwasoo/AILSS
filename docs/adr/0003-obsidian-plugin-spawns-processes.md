# 0003. Obsidian plugin spawns local Node processes

status: accepted

## Context

- The Obsidian plugin needs to provide a UI for AILSS search and indexing.
- The AILSS index DB uses SQLite + `sqlite-vec`, which is not practical to bundle inside the Obsidian plugin runtime.
- We want to reuse the same indexer and MCP server implementations across:
  - Codex CLI (via MCP STDIO)
  - Obsidian UI (plugin)

## Decision

- Keep the Obsidian plugin **desktop-only** and use it to spawn local Node.js processes:
  - Indexer CLI process (`@ailss/indexer`) for indexing / incremental updates
  - MCP server process (`@ailss/mcp`) for semantic search / metadata queries
- Communicate with the MCP server via **STDIO transport** (Model Context Protocol).
- Pass configuration via environment variables (e.g. `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `AILSS_VAULT_PATH`) from plugin settings to the spawned processes.

## Consequences

- Pros
  - Avoids bundling native DB dependencies into the plugin
  - Reuses the same code paths as the CLI
  - Clear separation: UI in plugin, heavy work in spawned processes
- Cons / risks
  - Desktop-only (requires `FileSystemAdapter`)
  - Process management complexity (errors, lifecycle, performance)
  - If the plugin spawns an MCP process per query, there is additional latency overhead

## Alternatives

- Bundle DB/indexer logic into the plugin
  - Pros: fewer moving parts
  - Cons: native module constraints; harder mobile story
- Run a long-lived local HTTP server
  - Pros: persistent process, lower per-query overhead
  - Cons: larger surface area; extra ops/security considerations
- Use a remote hosted service
  - Pros: potential mobile support
  - Cons: privacy, cost, and operational complexity
