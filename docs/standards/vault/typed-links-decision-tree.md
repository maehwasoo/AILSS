# Typed links decision tree

Use this decision tree when choosing relation keys.

## Quick path

1. Classification? -> `instance_of`
2. Parent/containment? -> `part_of`
3. Dependency vs usage?
   - Required prerequisite -> `depends_on`
   - Tool/service used in execution -> `uses`
4. Spec/policy/process implemented? -> `implements`
5. Source citation? -> `cites`
6. Content transformation?
   - Summary -> `summarizes`
   - Derived/paraphrased/translated -> `derived_from`
7. Reasoning/evidence?
   - Explanation -> `explains`
   - Supporting evidence -> `supports`
   - Contradiction/refutation -> `contradicts`
   - Validation/test proof -> `verifies`
8. Risk/control/measurement?
   - Blocker -> `blocks`
   - Mitigation -> `mitigates`
   - Measurement target -> `measures`
9. Process output? -> `produces`
10. Responsibility/versioning?

- Author -> `authored_by`
- Operator/owner -> `owned_by`
- Replacement -> `supersedes`
- Equivalent/duplicate -> `same_as`

## Selection rules

- Pick the most specific key; avoid generic “related-to” semantics.
- Use one-way links from current note to target note.
- Limit to the highest-confidence relations; avoid over-linking.
- If relation confidence is low, leave it out and keep a follow-up note.
