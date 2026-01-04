# 0001. Monorepo and package boundaries

status: accepted

## Context

- AILSS splits responsibilities across an indexer, an MCP server, and an Obsidian plugin
- We want to share common schema/logic (chunking, DB, etc.)
- We also want to keep runtime/deployment boundaries separate (especially plugin vs server)

## Decision

- Start with a pnpm-workspace monorepo
- Fix package boundaries as `packages/core`, `packages/indexer`, `packages/mcp`, `packages/obsidian-plugin`
- Restrict dependency direction to `core <- (indexer, mcp)`

## Consequences

- Pros
  - Easy shared-code reuse
  - Schema changes are tracked in a single repo
- Cons / risks
  - The repo may grow large over time
  - Boundary violations can happen (prevent via code review)

## Alternatives

- Split indexer/mcp/plugin into separate repos
  - Pros: clear deploy units
  - Cons: duplicated shared logic/schema and higher sync cost
