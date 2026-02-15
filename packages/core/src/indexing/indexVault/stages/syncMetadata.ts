import {
  replaceNoteSources,
  replaceNoteKeywords,
  replaceNoteTags,
  replaceTypedLinks,
  upsertFile,
  upsertNote,
} from "../../../db/db.js";
import { normalizeAilssNoteMeta } from "../../../vault/frontmatter.js";
import { parseMarkdownNote } from "../../../vault/markdown.js";
import { readUtf8File } from "../../../vault/filesystem.js";

import type { IndexedMarkdownFile, IndexVaultOptions, SyncedFileMetadata } from "../types.js";

export async function syncFileMetadataStage(
  options: IndexVaultOptions,
  file: IndexedMarkdownFile,
): Promise<SyncedFileMetadata> {
  const markdown = await readUtf8File(file.absPath);
  const parsed = parseMarkdownNote(markdown);
  const noteMeta = normalizeAilssNoteMeta(parsed.frontmatter);

  upsertFile(options.db, {
    path: file.relPath,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.size,
    sha256: file.sha256,
  });

  upsertNote(options.db, {
    path: file.relPath,
    noteId: noteMeta.noteId,
    created: noteMeta.created,
    title: noteMeta.title,
    summary: noteMeta.summary,
    entity: noteMeta.entity,
    layer: noteMeta.layer,
    status: noteMeta.status,
    updated: noteMeta.updated,
    frontmatterJson: JSON.stringify(noteMeta.frontmatter),
  });
  replaceNoteTags(options.db, file.relPath, noteMeta.tags);
  replaceNoteKeywords(options.db, file.relPath, noteMeta.keywords);
  replaceNoteSources(options.db, file.relPath, noteMeta.sources);
  replaceTypedLinks(options.db, file.relPath, noteMeta.typedLinks);

  return {
    body: parsed.body,
    embeddingInputMeta: {
      title: noteMeta.title ?? "",
      summary: noteMeta.summary ?? "",
    },
  };
}
