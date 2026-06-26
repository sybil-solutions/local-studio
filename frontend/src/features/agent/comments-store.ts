import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Comment = {
  id: string;
  line: number;
  body: string;
  createdAt: string;
};

type CommentsDocument = {
  // Map of relative path → comments. Stored on disk as
  // <project>/.local-studio/comments.json.
  files: Record<string, Comment[]>;
};

function commentsPath(rootCwd: string): string {
  return path.join(rootCwd, ".local-studio", "comments.json");
}

function readDocument(rootCwd: string): CommentsDocument {
  const filePath = commentsPath(rootCwd);
  if (!existsSync(filePath)) return { files: {} };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<CommentsDocument>;
    if (!parsed || typeof parsed !== "object" || !parsed.files) return { files: {} };
    return { files: parsed.files as CommentsDocument["files"] };
  } catch {
    return { files: {} };
  }
}

function writeDocument(rootCwd: string, document: CommentsDocument): void {
  const filePath = commentsPath(rootCwd);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}

function ensureRel(rel: string): string {
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid file path");
  }
  return rel;
}

function newId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listComments(rootCwd: string, rel: string): Comment[] {
  const safe = ensureRel(rel);
  const doc = readDocument(rootCwd);
  return doc.files[safe] ?? [];
}

export function addComment(rootCwd: string, rel: string, line: number, body: string): Comment {
  const safe = ensureRel(rel);
  const doc = readDocument(rootCwd);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment body is required");
  const comment: Comment = {
    id: newId(),
    line,
    body: trimmed,
    createdAt: new Date().toISOString(),
  };
  const next = { ...doc.files, [safe]: [...(doc.files[safe] ?? []), comment] };
  writeDocument(rootCwd, { files: next });
  return comment;
}

export function deleteComment(rootCwd: string, rel: string, id: string): void {
  const safe = ensureRel(rel);
  const doc = readDocument(rootCwd);
  const list = doc.files[safe];
  if (!list) return;
  const filtered = list.filter((c) => c.id !== id);
  if (filtered.length === list.length) return;
  writeDocument(rootCwd, {
    files: { ...doc.files, [safe]: filtered },
  });
}
