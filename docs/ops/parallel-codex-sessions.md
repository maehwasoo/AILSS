# Parallel Codex sessions

This note describes how to run multiple Codex CLI sessions against the same AILSS MCP server and vault without stepping on each other.

## How parallel sessions work in this project

- The MCP server supports multiple concurrent sessions. Each Codex process gets its own `Mcp-Session-Id`.
- The server shares a single vault database connection and uses a server-side write lock for write tools. This prevents file-level races, but it does not prevent logical conflicts if two sessions change the same note.
- Write tools are gated by `AILSS_ENABLE_WRITE_TOOLS=1` and require vault write permissions in the Codex sandbox (`writable_roots`).

## Recommended operating pattern

- Use multiple read-only sessions for exploration, and keep one dedicated writer session when you need to modify notes.
- Always use `apply=false` first for write tools, then apply once you confirm the preview.
- When editing an existing note, use `expected_sha256` with `edit_note` or `improve_frontmatter` to avoid overwriting a newer version.
- Avoid mixing `relocate_note` with edits to the same note from another session.
- If multiple sessions create new notes, coordinate titles or rely on the automatic unique filename behavior.

## Reindexing strategy

- Write tools default `reindex_after_apply=true`. This keeps the DB in sync but can be slow if you are doing many edits.
- For high-volume edits, consider setting `reindex_after_apply=false` in secondary sessions and run the indexer once after the batch.

## Permissions and configuration

- Keep write access scoped to the sessions that need it. For others, use DB-only access (or no write tools).
- See `docs/ops/codex-cli.md` for `writable_roots` and `AILSS_ENABLE_WRITE_TOOLS` setup.

## Troubleshooting

- If you see `HTTP status client error (400 Bad Request) ... initialize`, the MCP service likely only supports a single session. Restart the plugin-hosted server or update `@ailss/mcp`.
