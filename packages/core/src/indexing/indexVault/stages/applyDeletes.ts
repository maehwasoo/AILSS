import type { AilssDb } from "../../../db/db.js";
import { deleteChunksByIds } from "../../../db/db.js";

export function applyChunkDeleteStage(db: AilssDb, toDelete: string[]): void {
  if (toDelete.length === 0) return;
  deleteChunksByIds(db, toDelete);
}
