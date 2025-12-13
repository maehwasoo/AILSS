// DB 타입(types)

export type IndexedFileRow = {
  path: string;
  mtime_ms: number;
  size_bytes: number;
  sha256: string;
  updated_at: string;
};

export type IndexedChunkRow = {
  chunk_id: string;
  path: string;
  heading: string | null;
  heading_path_json: string;
  content: string;
  content_sha256: string;
  updated_at: string;
};

