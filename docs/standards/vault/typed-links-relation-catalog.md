# Typed links relation catalog

Use this document as the canonical semantic catalog for typed-link keys.

## Machine-readable canonical list

```yaml
typed_link_keys:
  - instance_of
  - part_of
  - depends_on
  - uses
  - implements
  - cites
  - summarizes
  - derived_from
  - explains
  - supports
  - contradicts
  - verifies
  - blocks
  - mitigates
  - measures
  - produces
  - authored_by
  - owned_by
  - supersedes
  - same_as
```

## Relation semantics

| Key            | Meaning                                   |
| -------------- | ----------------------------------------- |
| `instance_of`  | Classification / taxonomy relation        |
| `part_of`      | Composition / parent relation             |
| `depends_on`   | Hard dependency relation                  |
| `uses`         | Direct usage relation                     |
| `implements`   | Implements a spec/standard/process        |
| `cites`        | Strict source citation to another note    |
| `summarizes`   | Summary of another note                   |
| `derived_from` | Derived/transformed from another note     |
| `explains`     | Explains another note                     |
| `supports`     | Supporting evidence/argument              |
| `contradicts`  | Conflicting/refuting relation             |
| `verifies`     | Verification relation by test/measurement |
| `blocks`       | Blocking/precondition relation            |
| `mitigates`    | Risk mitigation relation                  |
| `measures`     | Metric/observation target relation        |
| `produces`     | Process output relation                   |
| `authored_by`  | Content authorship/attribution            |
| `owned_by`     | Current operational ownership             |
| `supersedes`   | Replacement/versioning relation           |
| `same_as`      | Equivalence/duplicate relation            |

## Field shape

- Store typed-link values as arrays of wikilinks.
- Keep stable ordering and deduplicate values.
- Omit the key when there are no values.
