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

export type PreviewKind = "html" | "jsx" | "md";
