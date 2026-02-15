export type {
  KeywordFacet,
  NoteMeta,
  NoteRow,
  SearchNotesFilters,
  SearchNotesResult,
  TagFacet,
  UpsertNoteInput,
} from "./notes/types.js";

export { listKeywords, listTags } from "./notes/facets.js";
export { getNoteMeta } from "./notes/meta.js";
export { searchNotes } from "./notes/search.js";
export {
  replaceNoteKeywords,
  replaceNoteSources,
  replaceNoteTags,
  upsertNote,
} from "./notes/upsert.js";
