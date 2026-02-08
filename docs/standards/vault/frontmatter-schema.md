# Frontmatter schema

## Frontmatter schema

All notes should keep the following YAML frontmatter template as the baseline.

```
---
id: "{{date:YYYYMMDDHHmmss}}"
created: "{{date:YYYY-MM-DDTHH:mm:ss}}"
title: {{title}}
summary:
aliases:
# concept | document | project | artifact | person | organization | place | event | task | method | tool | idea | principle | heuristic | pattern | definition | question | software | dataset | pipeline | procedure | dashboard | checklist | workflow | decide | review | plan | implement | approve | reject | observe | measure | test | verify | learn | research | summarize | publish | meet | audit | deploy | rollback | refactor | design | delete | update | create | schedule | migrate | reference | hub
entity:
# strategic | conceptual | logical | physical | operational
# why / what / structure / implementation / operations
layer:
tags: [] # Only use the inbox tag for notes under 100. Inbox/ (example: ['inbox'])
keywords: []
# draft | in-review | active | archived
status: draft
updated: "{{date:YYYY-MM-DDTHH:mm:ss}}"
source: []
---
```

### Field guidelines

- Frontmatter is the minimum metadata set needed to keep the knowledge graph consistent.
- Timestamps (`created`/`updated`) are expected to use system local time (no fixed timezone) and are stored as ISO to seconds without a timezone suffix (`YYYY-MM-DDTHH:mm:ss`).
- The `entity` field should use an allowed type (concept, document, project, guide, tool, etc.).
- The `layer` field should be one of: strategic, conceptual, logical, physical, operational.
- The `status` field should be one of: draft, in-review, active, archived.
- Relationship keys should use the typed-link keys (see `./typed-links.md`).
- If you are unsure, it is acceptable to leave `layer` empty temporarily and refine during review.
- Fill `tags`, `aliases`, `keywords`, and `source` only when needed (but keep the keys present).
- Prefer reusing existing `tags`/`keywords` vocabulary when possible (avoid near-duplicates like `llm` vs `LLM`).
- Typed links: only add typed-link keys when you have at least one value (omit empty arrays).

### `source` (external sources)

Use `source` to record **non-vault** sources that support the note (URLs, papers, tickets, specs, etc.).

- Type: **string array** (keep it present even when empty: `source: []`).
- Use when the “source” is not another vault note (for vault notes, prefer strict `cites` typed links instead).
- Prefer stable identifiers (URLs/DOIs) over long quotes; put quotes in the body and keep references in `source`.

### Typed links (relationships)

Typed links are optional frontmatter keys used to record semantic relations as wikilinks.

- Keep typed-link keys **below `source`** when present.
- Only include a key when you have at least one value; do not keep empty arrays.
- Keep `cites` strict for note-to-note citations. For non-citation relationships, use the other relation keys below.

Supported keys:

- `instance_of` (classification)
- `part_of` (composition)
- `depends_on`, `uses` (dependencies)
- `implements` (implementation)
- `cites` (strict citation to other vault notes)
- `summarizes` (summary of another note)
- `derived_from` (derived/transformed from another note, including translation/paraphrase)
- `explains` (explains another note)
- `supports` (evidence/argument supporting another note)
- `contradicts` (conflicts with/refutes another note)
- `verifies` (verifies another note via test/measurement/reproduction)
- `blocks` (direct blocker preventing progress of another note)
- `mitigates` (risk/issue mitigation relation to another note)
- `measures` (metric/observation relation targeting another note)
- `authored_by` (authorship/attribution)
- `supersedes` (replacement/versioning)
- `same_as` (equivalence/duplicates)

The supported key list is also encoded in the implementation (see `./typed-links.md` for the “sources of truth” that must be updated together when adding new keys).

## Layers: definition and classification

- **strategic (why)**: vision, principles, roadmap, and higher-level decision context.
- **conceptual (what)**: concepts, definitions, principles, patterns (tool-independent, general knowledge).
- **logical (how to structure)**: domain models, data flows, protocols (implementation-independent structure).
- **physical (how it is implemented)**: concrete code/config/repos/versions/files.
- **operational (running/observing)**: deployments, runbooks, monitoring, incidents, execution logs.

> **One-line test**
>
> - If changing the strategy would change everything else → strategic
> - If the essence stays the same even when tools change → conceptual
> - If only structure/rules are defined and implementation is TBD → logical
> - If specific files/repos/versions/config are the core → physical
> - If time, events, procedures, and results are central → operational

**Entity → layer mapping (suggestions)**

- `concept/definition/pattern/principle/heuristic` → usually conceptual
- `method` → conceptual or logical (depends on content)
- `api-spec/model` → logical (or physical if it is a concrete schema file)
- `software/tool/dataset/artifact` → physical
- `guide/runbook/dashboard` → operational (when centered on procedure/operations)
- `decision/incident/log/event` → operational
- `project` → strategic (goals/roadmap) or logical (structure docs)
- If you are unsure, default to conceptual and adjust later.

## Entity classification tables

The `entity` candidates are grouped into: interface, action, and object.

### Interface entities

| entity        | Default layer   | Alternate layers (case-by-case) | Reason (one line)                                                                                     |
| ------------- | --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **interface** | **logical**     | physical                        | The surface/contract (spec) is the structure; concrete IDL/files are physical.                        |
| **pipeline**  | **logical**     | physical, operational           | The designed stages/flow are the structure; CI YAML is physical, execution/monitoring is operational. |
| **procedure** | **operational** | —                               | A procedure/runbook is an operational activity by nature.                                             |
| **dashboard** | **operational** | physical                        | Dashboards are about observing/operating; dashboard JSON/config is physical.                          |
| **checklist** | **operational** | conceptual                      | Execution checklists are operational; tool-independent checklist principles can be conceptual.        |
| **workflow**  | **logical**     | operational                     | The workflow definition is structure; a concrete running instance is operational.                     |

### Action entities

| action        | Default layer   | Alternate layers (case-by-case) | Reason (one line)                                                                               |
| ------------- | --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| **decide**    | **strategic**   | operational                     | High-level decisions/principles are strategic; gate approvals as events are operational.        |
| **review**    | **operational** | strategic, logical              | Reviews are time/action-centered; roadmap/architecture reviews can be strategic/logical.        |
| **plan**      | **strategic**   | operational                     | Roadmaps/OKRs are strategic; sprint scheduling is operational.                                  |
| **implement** | **physical**    | operational                     | Code/config changes are physical; tracking the execution is operational.                        |
| **approve**   | **operational** | strategic                       | Approvals are events (operational); approval principles/policies are strategic.                 |
| **reject**    | **operational** | —                               | Rejecting is an event.                                                                          |
| **observe**   | **operational** | —                               | Observation/monitoring is operational.                                                          |
| **measure**   | **operational** | conceptual                      | Measuring is operational; metric definitions can be conceptual.                                 |
| **test**      | **operational** | physical, logical               | Test execution/results are operational; test code/specs are physical/logical.                   |
| **verify**    | **operational** | —                               | Verification is an operational gate.                                                            |
| **learn**     | **conceptual**  | operational                     | General lessons are conceptual; a retrospective event is operational.                           |
| **research**  | **conceptual**  | strategic                       | Tool-independent exploration is conceptual; direction-setting research can be strategic.        |
| **summarize** | **conceptual**  | operational                     | Summaries as knowledge are conceptual; release-note writing tied to an event is operational.    |
| **publish**   | **operational** | physical                        | Publishing is an operational action; generating/uploading an artifact can be physical.          |
| **meet**      | **operational** | —                               | Meetings are time-based events.                                                                 |
| **audit**     | **operational** | strategic                       | Auditing is operational; creating policies/standards is strategic.                              |
| **deploy**    | **operational** | physical                        | Deploy execution/logs are operational; manifests/scripts are physical.                          |
| **rollback**  | **operational** | physical                        | Rollback execution/results are operational; rollback scripts/snapshots are physical.            |
| **refactor**  | **physical**    | logical                         | Code/config refactors are physical; refactoring rules/structure principles can be logical.      |
| **design**    | **logical**     | strategic, physical             | Architecture/model design is logical; principles are strategic; file artifacts are physical.    |
| **delete**    | **physical**    | operational                     | Deleting files/data is physical; the operational window/process is operational.                 |
| **update**    | **physical**    | operational                     | Updating code/config/schema is physical; change-management events are operational.              |
| **create**    | **physical**    | operational                     | Creating artifacts/resources is physical; tracking the work is operational.                     |
| **schedule**  | **operational** | strategic                       | Scheduling is operational; long-term roadmaps can be strategic.                                 |
| **migrate**   | **operational** | physical                        | Migration execution/procedure is operational; scripts/mappings are physical.                    |
| **analyze**   | **conceptual**  | operational                     | Analysis that produces general insight is conceptual; incident/log analysis can be operational. |

### Object entities

| object           | Default layer   | Alternate layers (case-by-case) | Reason (one line)                                                                               |
| ---------------- | --------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| **concept**      | **conceptual**  | —                               | General concepts/definitions are conceptual.                                                    |
| **document**     | **physical**    | conceptual                      | A document is a concrete artifact; pure definitions can be conceptual.                          |
| **project**      | **strategic**   | logical                         | Goals/scope are strategic; structure docs can be logical.                                       |
| **artifact**     | **physical**    | —                               | Build outputs and artifacts are physical.                                                       |
| **person**       | **logical**     | operational                     | A person as a domain entity is logical; scheduling/action logs are operational.                 |
| **organization** | **logical**     | strategic                       | Organizations as entities are logical; governance/policy context can be strategic.              |
| **place**        | **logical**     | operational                     | Places as entities are logical; event context can be operational.                               |
| **event**        | **operational** | logical                         | Events are time-based (operational); event-type definitions can be logical.                     |
| **task**         | **operational** | logical                         | Tasks/backlog items are operational; task type/state models can be logical.                     |
| **method**       | **conceptual**  | logical                         | General methods are conceptual; protocol/step structures can be logical.                        |
| **tool**         | **physical**    | conceptual                      | Concrete software/services are physical; tool-independent guidance can be conceptual.           |
| **idea**         | **conceptual**  | —                               | Ideas are conceptual.                                                                           |
| **principle**    | **conceptual**  | strategic                       | Principles are conceptual; in a high-level decision context they can be strategic.              |
| **heuristic**    | **conceptual**  | —                               | Heuristics/tips are conceptual.                                                                 |
| **pattern**      | **conceptual**  | logical                         | Patterns are conceptual; when projected into system structure they can be logical.              |
| **definition**   | **conceptual**  | —                               | Definitions are conceptual.                                                                     |
| **question**     | **conceptual**  | —                               | Questions are conceptual units of inquiry.                                                      |
| **software**     | **physical**    | —                               | Concrete software/package/version is physical.                                                  |
| **dataset**      | **physical**    | —                               | Concrete data/schema/version is physical.                                                       |
| **reference**    | **conceptual**  | physical                        | References are conceptual; specific reference files can be physical.                            |
| **hub**          | **physical**    | logical                         | A hub note/file is a concrete navigation artifact; structure definition can be logical.         |
| **guide**        | **operational** | conceptual                      | Procedure-heavy guidance is operational; pure principles can be conceptual.                     |
| **log**          | **operational** | physical, logical               | Facts recorded during operations are operational; schema/structure can be physical/logical.     |
| **structure**    | logical         | physical, conceptual            | Structure/boundary rules are logical; when tied to implementation they can be physical.         |
| **architecture** | logical         | strategic, physical             | Architecture is logical structure; principles can be strategic; file artifacts can be physical. |

## Quick classification tips

- If you see files/repos/versions/config → physical
- If time/events (deploy/meeting/incident) are central → operational
- If the content is tool-independent concepts/definitions/principles → conceptual
- If it is domain entities/flows/boundary rules → logical
- If it is vision/roadmap/high-level decisions → strategic

## Example frontmatter templates

### Concept note

```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: Domain-Driven Design
summary: Summary of core concepts and patterns
aliases: ["도메인 주도 설계", "DDD"]
entity: concept
layer: conceptual
tags: ['architecture']
keywords: []
status: draft
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
source: []
instance_of: ['[[concept]]']
---
```

### Project note

```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: WorldAce v2 Roadmap
summary: Summary of quarterly goals and milestones
aliases: ["WorldAce v2 로드맵"]
entity: project
layer: strategic
tags: []
keywords: []
status: in-review
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
source: []
part_of: ['[[WorldAce]]']
depends_on: ['[[Vite]]', '[[Cloudflare]]']
---
```

### Procedure note

```
---
id: {{date:YYYYMMDDHHmmss}}
created: {{date:YYYY-MM-DDTHH:mm:ss}}
title: Deployment Procedure
summary: Deployment steps (staging → production) and verification criteria
aliases: ["배포 절차"]
entity: procedure
layer: operational
tags: []
keywords: []
status: active
updated: {{date:YYYY-MM-DDTHH:mm:ss}}
source: []
implements: ['[[CI Pipeline]]']
---
```
