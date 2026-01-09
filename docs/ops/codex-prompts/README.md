# Codex prompt snippets (copy/paste)

This folder contains **copy/paste prompt snippets** intended for **Codex CLI** users.

These are meant to be installed manually under your Codex prompts directory:

- `~/.codex/prompts/`

## How to install

1. Pick a prompt file from this folder, for example:
   - `prometheus-agent.md`
2. Copy its full contents.
3. Create a new file under `~/.codex/prompts/` with the same name, for example:
   - `~/.codex/prompts/prometheus-agent.md`
4. In Codex CLI, run the corresponding slash command:
   - `/prometheus-agent`

Notes:

- Prompt filenames map to slash commands by basename (for example `prometheus-agent.md` → `/prometheus-agent`).
- These prompts are guidance for Codex; they do not change MCP server behavior.
- Prompt YAML frontmatter may include `mcp_tools` (string array) to declare which MCP tools the prompt expects to use.
