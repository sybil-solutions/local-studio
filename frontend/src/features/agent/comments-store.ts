import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "@/lib/guards";

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

async function readDocument(rootCwd: string): Promise<CommentsDocument> {
  try {
    const parsed: unknown = JSON.parse(await readFile(commentsPath(rootCwd), "utf-8"));
    if (!isRecord(parsed) || !isRecord(parsed.files)) return { files: {} };
    return { files: parsed.files as CommentsDocument["files"] };
  } catch {
    return { files: {} };
  }
}

async function writeDocument(rootCwd: string, document: CommentsDocument): Promise<void> {
  const filePath = commentsPath(rootCwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
}

function ensureRel(rel: string): string {
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid file path");
  }
  return rel;
}

export async function listComments(rootCwd: string, rel: string): Promise<Comment[]> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  return doc.files[safe] ?? [];
}

export async function addComment(
  rootCwd: string,
  rel: string,
  line: number,
  body: string,
): Promise<Comment> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comment body is required");
  const comment: Comment = {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    line,
    body: trimmed,
    createdAt: new Date().toISOString(),
  };
  await writeDocument(rootCwd, {
    files: { ...doc.files, [safe]: [...(doc.files[safe] ?? []), comment] },
  });
  return comment;
}

export async function deleteComment(rootCwd: string, rel: string, id: string): Promise<void> {
  const safe = ensureRel(rel);
  const doc = await readDocument(rootCwd);
  const list = doc.files[safe];
  if (!list) return;
  const filtered = list.filter((c) => c.id !== id);
  if (filtered.length === list.length) return;
  await writeDocument(rootCwd, {
    files: { ...doc.files, [safe]: filtered },
  });
}
