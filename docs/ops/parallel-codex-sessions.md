# Parallel Codex sessions (single Obsidian-hosted MCP server)

This document is an **ops playbook** for running **multiple Codex sessions** against a **single AILSS MCP server** (typically hosted by the Obsidian plugin over localhost).

The goal is to let you work in parallel without creating broken session state, stale DB lookups, or expensive indexing thrash.

## Mental model

- **Read tools** (DB reads / vault reads) can be used freely in parallel.
- **Write tools** (`apply=true`) are serialized inside the MCP server by an in-process write lock.
  - This prevents “two MCP writes at the exact same time” _inside the same server process_.
  - It does **not** prevent conflicts with external edits (for example you typing in Obsidian at the same time).
- **Indexing** (embedding + DB writes) is expensive and can block other work if triggered too often.

## Key terms

- **Session note**: the “anchor” note created by `sequentialthinking` (frontmatter `id` is the canonical session key).
- **Thought note**: one note per `thoughtNumber`, linked to the session.
- **`session_note_id`**: the session note’s frontmatter `id` (stored in the DB as `notes.note_id`).
  - Stable across relocates/renames/folder changes (best resume key).
- **`session_path`**: the current vault-relative path of the session note (useful fallback when DB is stale).

## Recommended operating rules (parallel safe)

### 1) Session ownership: “one session note = one writer”

If you have multiple Codex sessions open, pick **exactly one** of them to be the **writer** for a given sequentialthinking session.

- Writer session:
  - Calls `sequentialthinking` with `apply=true` to append new thought notes.
  - Keeps track of `thoughtNumber` increments.
- Other sessions:
  - Use `sequentialthinking_hydrate` (and other read tools) to rebuild context quickly.
  - Avoid calling `sequentialthinking apply=true` for the same session unless you coordinate `thoughtNumber`.

Why: even if writes are serialized, two humans/sessions can still create logical conflicts (duplicate `thoughtNumber`, divergent branches without coordination).

### 2) Keep both resume keys

Always store both:

- `session_note_id` (durable key)
- `session_path` (immediate fallback)

If DB is stale/unindexed, `session_note_id` resolution can fail; `session_path` still works.

### 3) Indexing policy: avoid “indexing thrash”

Default recommendation:

- Keep `reindex_after_apply=false` for routine thinking logs.

Only reindex when you specifically need DB-backed operations that depend on fresh metadata, such as:

- resuming by `session_note_id` in a new Codex session (DB lookup needed)
- resolving moved notes after `relocate_note`

If multiple Codex sessions might request indexing, decide on an “indexing owner” session to run it, instead of having every session trigger reindex.

### 4) Relocate policy

Moving notes is safe for relationships because links are title-based (`[[Title]]`), but DB lookups may lag.

After moving a session note:

- Path-based workflows: continue by the new `session_path` (no DB required)
- ID-based workflows: reindex the moved note path so `session_note_id` → path resolution works

### 5) Avoid editing the session note in Obsidian while writing

`sequentialthinking` updates the session note frontmatter (`see_also`, `branch_ids`).

If you manually edit the same session note in Obsidian concurrently, you can create a last-write-wins overwrite pattern.

Safer options:

- edit thought notes instead (append-only style)
- pause sequentialthinking writes while doing large manual edits to the session note

## Recommended workflow patterns

### Pattern A: New task (single writer)

1. Writer session: call `sequentialthinking apply=true` for `thoughtNumber=1`.
2. Save `session_note_id` + `session_path`.
3. Other sessions: use `sequentialthinking_hydrate` by `session_note_id` to load context.

### Pattern B: Resume after a break (different Codex session)

1. Call `sequentialthinking_hydrate` with `session_note_id`.
2. If it fails with “not found”, reindex the session note path (or use `session_path` if you still have it).

## Common failure modes and fixes

- **“Session note not found for session_note_id”**
  - DB is stale or the note was never indexed → reindex (or use `session_path`).
- **“Multiple notes found for session_note_id”**
  - Duplicate frontmatter `id` values exist → repair the duplicates.
- **hydrate returns unresolved/ambiguous targets**
  - Reindex so DB can resolve titles/paths more reliably, or rename to avoid duplicated titles.
