export type TypedLinkRecord = {
  rel: string;
  to_target: string;
  to_wikilink: string;
  position: number;
};

export type FrontmatterEnumViolation = {
  key: "status" | "layer" | "entity";
  value: string | null;
};

export type ScannedNote = {
  path: string;
  has_frontmatter: boolean;
  parsed_frontmatter: boolean;
  missing_keys: string[];
  enum_violations: FrontmatterEnumViolation[];
  id_value: string | null;
  created_value: string | null;
  id_format_ok: boolean;
  created_format_ok: boolean;
  id_matches_created: boolean;
  note_id: string | null;
  title: string | null;
  entity: string | null;
  typed_links: TypedLinkRecord[];
};

export type TargetLookupNote = Pick<
  ScannedNote,
  "path" | "parsed_frontmatter" | "note_id" | "title" | "entity"
>;

export type TypedLinkDiagnostic = {
  path: string;
  rel: string;
  target: string | null;
  reason: string;
  fix_hint: string;
  severity: "warn" | "error";
};
