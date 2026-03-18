# 0008. Adopt a Python-first local agent backend while keeping Node as the transition layer

status: accepted

## Context

- Issue #175 establishes the next AILSS baseline around a Python-first local agent backend.
- The repo already has strong local-first building blocks in Node/TypeScript:
  - indexer
  - MCP transport
  - explicit/gated write tools
  - Obsidian plugin integration
- The repo also needs backend capabilities that are more agent-centric than transport-centric:
  - retrieval orchestration
  - step-based agent workflow control
  - reproducible eval runs
  - lightweight observability for latency, failures, and token summaries
- Python currently has a stronger agent-backend ecosystem than Node/TypeScript for this kind of work.
  - orchestration libraries such as LangGraph are more direct for stateful multi-step flows
  - eval, tracing, observability, and model SDK tooling are often deeper or appear earlier in Python
  - retrieval, embeddings, reranking, and dataset-driven testing examples are more common in Python
- That advantage mostly helps the agent backend layer, not the entire product.
  - vault storage rules
  - typed-link ontology
  - MCP safety boundaries
  - Obsidian UX ownership
    are still valid and should not be discarded just because the backend language changes.
- A full immediate rewrite would be risky because the existing Node/TypeScript path still owns important production behavior.
  - index maintenance
  - localhost MCP transport
  - gated write tools

## Decision

- Adopt a Python-first local backend as the target runtime direction for retrieval, agent workflow, and eval behavior.
- Use FastAPI as the current local backend surface for:
  - `GET /health`
  - `POST /retrieve`
  - `POST /agent/run`
  - `POST /eval/run`
- Use LangGraph for the core `/agent/run` baseline flow:
  - `retrieve -> decide -> read -> answer -> validate`
- Keep the Obsidian plugin as the local UX shell and service launcher.
- Keep the existing Node/TypeScript packages as the transition layer for now.
  - indexing stays on the current path
  - MCP transport stays on the current path
  - explicit/gated vault write tools stay on the current path
- Treat the Python backend as the primary direction for future local agent runtime work, but do not remove the Node/TypeScript runtime until parity is explicitly verified.

## Consequences

- Pros
  - Aligns the repo with the ecosystem that is currently friendlier for agent-backend construction
  - Gives AILSS a clearer backend contract for retrieval, orchestration, eval, and observability
  - Lets the plugin remain focused on UX, startup, and supervision instead of becoming the main agent runtime
  - Preserves the current safety model for vault writes while the Python path matures
  - Makes later migration sequencing explicit instead of mixing baseline work with full-runtime removal
- Cons / risks
  - Introduces a dual-runtime period with both Node/TypeScript and Python in the repo
  - Increases development and debugging complexity during migration
  - LangGraph adds structural weight before the answer stage is a full LLM reasoning path
  - Migration can stall in an uncomfortable middle state if parity and cleanup work are not completed

## Alternatives

- Keep the backend fully on Node/TypeScript
  - Lower short-term complexity and better continuity with the current plugin/runtime stack
  - Rejected because the agent-backend ecosystem fit is weaker for the planned orchestration/eval direction
- Rewrite the backend completely in Python immediately and remove Node/TypeScript early
  - Cleaner on paper, but too risky before parity is proven for indexing, MCP transport, and gated writes
- Keep FastAPI but avoid LangGraph and implement the workflow as ad hoc function calls only
  - Simpler at the start, but weaker for explicit state transitions, failure semantics, eval tracing, and future workflow growth
- Make the Obsidian plugin the main orchestration layer
  - Rejected because it would overload the plugin with backend concerns and blur the local runtime boundary

## Follow-up

- `#175` remains the baseline-establishing issue, not the full migration issue.
- Later-phase migration is tracked separately in `#179`.
- Expected next migration order:
  - `#182` verify Python parity for the current MCP read/write tool surface
  - `#180` re-center the Obsidian plugin around the Python backend runtime
  - `#181` plan staged removal of the legacy Node/TypeScript runtime path
