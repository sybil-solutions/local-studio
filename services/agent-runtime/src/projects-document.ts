import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  constants,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import { CHATS_PROJECT_ID } from "../../../shared/agent/project-ids";
import {
  ensureOwnerDirectory,
  ownerFileExists,
  readOwnerFile,
  syncOwnerDirectory,
} from "./owner-files";

const ProjectRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  addedAt: Schema.String,
});

const ProjectsDocumentSchema = Schema.Struct({
  projects: Schema.Array(ProjectRecordSchema),
});

export type ProjectRecord = typeof ProjectRecordSchema.Type;
export type ProjectsDocument = typeof ProjectsDocumentSchema.Type;

export function stableDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeOwnerFileAtomic(filePath: string, payload: string | Uint8Array): void {
  const directory = path.dirname(filePath);
  ensureOwnerDirectory(directory);
  ownerFileExists(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, payload);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, filePath);
    syncOwnerDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function decodeProjectsDocument(
  content: string | Uint8Array,
  filePath: string,
): ProjectsDocument {
  try {
    const source = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    return Schema.decodeUnknownSync(ProjectsDocumentSchema)(JSON.parse(source));
  } catch {
    throw new Error(`Invalid projects registry: ${filePath}`);
  }
}

export function readProjectsDocument(filePath: string): ProjectsDocument {
  if (!ownerFileExists(filePath)) return { projects: [] };
  return decodeProjectsDocument(readOwnerFile(filePath).content, filePath);
}

export function writeProjectsDocument(filePath: string, document: ProjectsDocument): void {
  writeOwnerFileAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

export function projectPathKey(projectPath: string): string {
  let resolved: string;
  try {
    resolved = realpathSync.native(projectPath);
  } catch {
    resolved = path.resolve(projectPath);
  }
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function availableProjectId(id: string, pathKey: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(id)) return id;
  const base = `proj-migrated-${stableDigest(pathKey)}`;
  if (!usedIds.has(base)) return base;
  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function mergeProjectRecords(
  ...sources: ReadonlyArray<ReadonlyArray<ProjectRecord>>
): ProjectRecord[] {
  const paths = new Set<string>();
  const ids = new Set<string>([CHATS_PROJECT_ID]);
  const projects: ProjectRecord[] = [];
  for (const source of sources) {
    for (const project of source) {
      if (project.id === CHATS_PROJECT_ID) continue;
      const pathKey = projectPathKey(project.path);
      if (paths.has(pathKey)) continue;
      const id = availableProjectId(project.id, pathKey, ids);
      paths.add(pathKey);
      ids.add(id);
      projects.push(id === project.id ? project : { ...project, id });
    }
  }
  return projects;
}
