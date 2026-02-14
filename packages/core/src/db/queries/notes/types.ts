export type UpsertNoteInput = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  frontmatterJson: string;
};

export type NoteRow = {
  path: string;
  note_id: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  frontmatter_json: string;
  updated_at: string;
};

export type NoteMeta = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  keywords: string[];
  sources: string[];
  frontmatter: Record<string, unknown>;
  typedLinks: Array<{
    rel: string;
    toTarget: string;
    toWikilink: string;
    position: number;
  }>;
};

export type SearchNotesFilters = {
  pathPrefix?: string;
  titleQuery?: string;
  noteId?: string | string[];
  entity?: string | string[];
  layer?: string | string[];
  status?: string | string[];
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  tagsAny?: string[];
  tagsAll?: string[];
  keywordsAny?: string[];
  sourcesAny?: string[];
  orderBy?: "path" | "created" | "updated";
  orderDir?: "asc" | "desc";
  limit?: number;
};

export type SearchNotesResult = {
  path: string;
  noteId: string | null;
  created: string | null;
  title: string | null;
  summary: string | null;
  entity: string | null;
  layer: string | null;
  status: string | null;
  updated: string | null;
  tags: string[];
  keywords: string[];
  sources: string[];
};

export type TagFacet = { tag: string; count: number };

export type KeywordFacet = { keyword: string; count: number };
