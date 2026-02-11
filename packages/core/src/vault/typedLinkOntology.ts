// Canonical typed-link ontology
// - single-source relation keys + semantics + optional constraints

type TypedLinkOntologySeed = {
  rel: string;
  semantics: string;
  decisionTest: string;
  constraints?: {
    maxTargets?: number;
    sourceEntities?: readonly string[];
    targetEntities?: readonly string[];
    conflictsWith?: readonly string[];
  };
};

function relationKeysFromOntology<const T extends readonly { rel: string }[]>(ontology: T) {
  return ontology.map((entry) => entry.rel) as unknown as {
    readonly [K in keyof T]: T[K] extends { rel: infer R extends string } ? R : never;
  };
}

export const AILSS_TYPED_LINK_ONTOLOGY = [
  {
    rel: "instance_of",
    semantics: "taxonomy and classification",
    decisionTest: "This note is a kind of X.",
  },
  {
    rel: "part_of",
    semantics: "part-whole composition",
    decisionTest: "This note belongs under X as a component.",
  },
  {
    rel: "depends_on",
    semantics: "hard dependency",
    decisionTest: "This note cannot work without X.",
  },
  {
    rel: "uses",
    semantics: "direct usage",
    decisionTest: "This note uses X as a tool or service.",
  },
  {
    rel: "implements",
    semantics: "specification implementation",
    decisionTest: "This note implements X as a standard or architecture.",
  },
  {
    rel: "cites",
    semantics: "strict citation",
    decisionTest: "This note cites X as a source reference.",
  },
  {
    rel: "summarizes",
    semantics: "summary transformation",
    decisionTest: "This note is a summary of X.",
  },
  {
    rel: "derived_from",
    semantics: "derivation or transformation",
    decisionTest: "This note was derived from X by extraction or paraphrase.",
  },
  {
    rel: "explains",
    semantics: "explanatory relation",
    decisionTest: "This note helps explain X.",
  },
  {
    rel: "supports",
    semantics: "supporting evidence",
    decisionTest: "This note provides evidence for X.",
    constraints: {
      conflictsWith: ["contradicts"],
    },
  },
  {
    rel: "contradicts",
    semantics: "conflicting evidence",
    decisionTest: "This note conflicts with or refutes X.",
  },
  {
    rel: "verifies",
    semantics: "verification result",
    decisionTest: "This note verifies X through testing or measurement.",
  },
  {
    rel: "blocks",
    semantics: "blocking dependency",
    decisionTest: "This note is blocked by unresolved X.",
  },
  {
    rel: "mitigates",
    semantics: "risk mitigation",
    decisionTest: "This note mitigates risk or impact for X.",
  },
  {
    rel: "measures",
    semantics: "observation or measurement target",
    decisionTest: "This note measures or observes X.",
  },
  {
    rel: "produces",
    semantics: "process output relation",
    decisionTest: "This process or workflow note produces X.",
    constraints: {
      sourceEntities: ["procedure", "pipeline", "workflow"],
      targetEntities: ["artifact", "dataset", "document", "software", "dashboard", "reference"],
    },
  },
  {
    rel: "authored_by",
    semantics: "authorship attribution",
    decisionTest: "This note was authored by X.",
    constraints: {
      targetEntities: ["person", "organization"],
    },
  },
  {
    rel: "owned_by",
    semantics: "operational ownership",
    decisionTest: "This note is operationally owned by X.",
    constraints: {
      maxTargets: 1,
      targetEntities: ["person", "organization"],
    },
  },
  {
    rel: "supersedes",
    semantics: "replacement or versioning",
    decisionTest: "This note replaces X.",
  },
  {
    rel: "same_as",
    semantics: "equivalence or duplicate",
    decisionTest: "This note is equivalent to X.",
  },
] as const satisfies readonly TypedLinkOntologySeed[];

export const AILSS_TYPED_LINK_KEYS = relationKeysFromOntology(AILSS_TYPED_LINK_ONTOLOGY);

export type AilssTypedLinkKey = (typeof AILSS_TYPED_LINK_KEYS)[number];

export type AilssTypedLinkConstraints = {
  maxTargets?: number;
  sourceEntities?: readonly string[];
  targetEntities?: readonly string[];
  conflictsWith?: readonly AilssTypedLinkKey[];
};

export type AilssTypedLinkOntologyEntry = {
  rel: AilssTypedLinkKey;
  semantics: string;
  decisionTest: string;
  constraints?: AilssTypedLinkConstraints;
};

export const AILSS_TYPED_LINK_ONTOLOGY_BY_REL: Readonly<
  Record<AilssTypedLinkKey, AilssTypedLinkOntologyEntry>
> = Object.freeze(
  Object.fromEntries(
    AILSS_TYPED_LINK_ONTOLOGY.map((entry) => [
      entry.rel,
      {
        rel: entry.rel,
        semantics: entry.semantics,
        decisionTest: entry.decisionTest,
        constraints:
          "constraints" in entry
            ? (entry.constraints as AilssTypedLinkConstraints | undefined)
            : undefined,
      },
    ]),
  ) as Record<AilssTypedLinkKey, AilssTypedLinkOntologyEntry>,
);

export function isAilssTypedLinkKey(rel: string): rel is AilssTypedLinkKey {
  return (AILSS_TYPED_LINK_KEYS as readonly string[]).includes(rel);
}
