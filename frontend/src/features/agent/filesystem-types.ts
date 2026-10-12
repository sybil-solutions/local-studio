export type FsEntry = {
  name: string;
  path: string;
  rel: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

export type FileComment = {
  id: string;
  line: number;
  body: string;
  createdAt: string;
};

// "image" and "pdf" render the file's own bytes (via /api/agent/fs/raw) rather
// than a text read, so the panel never tries to decode them as UTF-8.
export type PreviewKind = "html" | "jsx" | "md" | "image" | "pdf";
