import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { Schema } from "effect";
import { CHATS_PROJECT_ID } from "../../../shared/agent/project-ids";
import {
  ProjectsDocumentSchema,
  type ProjectEntry,
  type ProjectRecord,
  type ProjectsDocument,
} from "../../../shared/agent/projects";
import { resolveDataDir } from "./data-dir";

export type { ProjectEntry, ProjectRecord };

const MigrationMarkerSchema = Schema.Struct({
  version: Schema.Literal(1),
  completedSources: Schema.Array(Schema.String),
});
type MigrationMarker = typeof MigrationMarkerSchema.Type;
type FileSnapshot = { content: string; document: ProjectsDocument };
const LOCK_ATTEMPTS = 100;
const LOCK_RETRY_MS = 20;

export function resolveProjectsFilePath(): string {
  return path.join(resolveDataDir(), "projects.json");
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function assertRegularFile(filePath: string): void {
  if (!lstatSync(filePath).isFile()) throw new Error(`Unsafe projects registry path: ${filePath}`);
}

function readOwnerFile(filePath: string): string {
  assertRegularFile(filePath);
  chmodSync(filePath, 0o600);
  return readFileSync(filePath, "utf8");
}

function readSourceFile(filePath: string): string {
  assertRegularFile(filePath);
  return readFileSync(filePath, "utf8");
}

function writeAtomic(filePath: string, content: string): void {
  ensureDirectory(path.dirname(filePath));
  if (existsSync(filePath)) assertRegularFile(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, filePath);
    chmodSync(filePath, 0o600);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function decodeDocument(content: string, filePath: string): ProjectsDocument {
  try {
    return Schema.decodeUnknownSync(ProjectsDocumentSchema)(JSON.parse(content));
  } catch {
    throw new Error(`Invalid projects registry: ${filePath}`);
  }
}

function readSnapshot(filePath: string, readFile = readOwnerFile): FileSnapshot | null {
  if (!existsSync(filePath)) return null;
  const content = readFile(filePath);
  return { content, document: decodeDocument(content, filePath) };
}

function writeDocument(filePath: string, document: ProjectsDocument): void {
  writeAtomic(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function projectPathKey(projectPath: string): string {
  let resolved: string;
  try {
    resolved = realpathSync.native(projectPath);
  } catch {
    resolved = path.resolve(projectPath);
  }
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function mergeProjects(current: readonly ProjectRecord[], additions: readonly ProjectRecord[]) {
  const paths = new Set(current.map((project) => projectPathKey(project.path)));
  const ids = new Set([CHATS_PROJECT_ID, ...current.map((project) => project.id)]);
  const merged = [...current];
  for (const project of additions) {
    const key = projectPathKey(project.path);
    if (project.id === CHATS_PROJECT_ID || paths.has(key)) continue;
    let id = project.id;
    if (ids.has(id)) {
      const base = `proj-migrated-${digest(key).slice(0, 16)}`;
      id = base;
      for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${suffix}`;
    }
    merged.push(id === project.id ? project : { ...project, id });
    paths.add(key);
    ids.add(id);
  }
  return merged;
}

function legacyProjectPaths(): string[] {
  const candidates = new Set<string>();
  const override = process.env.LOCAL_STUDIO_PROJECTS_FILE?.trim();
  if (override) candidates.add(path.resolve(process.cwd(), override));
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.add(path.join(directory, "data", "agentfs", "projects.json"));
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const canonical = path.resolve(resolveProjectsFilePath());
  return [...candidates]
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => candidate !== canonical && existsSync(candidate))
    .sort();
}

function markerPath(canonicalFile: string): string {
  return path.join(path.dirname(canonicalFile), "projects-migration.json");
}

function readMarker(canonicalFile: string): MigrationMarker {
  const filePath = markerPath(canonicalFile);
  if (!existsSync(filePath)) return { version: 1, completedSources: [] };
  try {
    return Schema.decodeUnknownSync(MigrationMarkerSchema)(JSON.parse(readOwnerFile(filePath)));
  } catch {
    throw new Error(`Invalid projects migration marker: ${filePath}`);
  }
}

function ensureBackup(canonicalFile: string, kind: string, content: string): string {
  const filePath = `${canonicalFile}.${kind}-${digest(content).slice(0, 16)}.backup`;
  const existing = existsSync(filePath) ? readOwnerFile(filePath) : null;
  if (existing !== null && existing !== content) throw new Error(`Invalid backup: ${filePath}`);
  if (existing === null) writeAtomic(filePath, content);
  return path.basename(filePath);
}

function migrateLegacyProjects(canonicalFile: string): void {
  const original = readSnapshot(canonicalFile);
  let projects = mergeProjects([], original?.document.projects ?? []);
  const completed = new Set(readMarker(canonicalFile).completedSources);
  let canonicalBackedUp = false;
  if (JSON.stringify({ projects }) !== JSON.stringify(original?.document ?? { projects: [] })) {
    if (original) ensureBackup(canonicalFile, "canonical", original.content);
    writeDocument(canonicalFile, { projects });
    canonicalBackedUp = original !== null;
  }
  for (const sourcePath of legacyProjectPaths()) {
    const sourceKey = process.platform === "win32" ? sourcePath.toLowerCase() : sourcePath;
    if (completed.has(sourceKey)) continue;
    const snapshot = readSnapshot(sourcePath, readSourceFile);
    if (!snapshot) continue;
    ensureBackup(canonicalFile, "legacy", snapshot.content);
    const merged = mergeProjects(projects, snapshot.document.projects);
    if (JSON.stringify(merged) !== JSON.stringify(projects)) {
      if (original && !canonicalBackedUp) {
        ensureBackup(canonicalFile, "canonical", original.content);
        canonicalBackedUp = true;
      }
      writeDocument(canonicalFile, { projects: merged });
      projects = merged;
    }
    completed.add(sourceKey);
    const nextMarker = { version: 1 as const, completedSources: [...completed].sort() };
    writeAtomic(markerPath(canonicalFile), `${JSON.stringify(nextMarker, null, 2)}\n`);
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function withStoreLock<T>(callback: (filePath: string) => T): T {
  const filePath = resolveProjectsFilePath();
  ensureDirectory(path.dirname(filePath));
  let release: (() => void) | undefined;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS && !release; attempt += 1) {
    try {
      release = lockfile.lockSync(filePath, { realpath: false, stale: 10_000, update: 2_000 });
    } catch (error) {
      if (errorCode(error) !== "ELOCKED" || attempt === LOCK_ATTEMPTS - 1) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  if (!release) throw new Error(`Timed out waiting for projects registry lock: ${filePath}`);
  try {
    migrateLegacyProjects(filePath);
    return callback(filePath);
  } finally {
    release();
  }
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function gitBranchFor(projectPath: string): string | null {
  try {
    const head = readFileSync(path.join(projectPath, ".git", "HEAD"), "utf8").trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return match?.[1] ?? (/^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null);
  } catch {
    return null;
  }
}

function withMeta(record: ProjectRecord): ProjectEntry {
  return {
    ...record,
    exists: isExistingDirectory(record.path),
    hasGit: existsSync(path.join(record.path, ".git")),
    branch: gitBranchFor(record.path),
  };
}

function chatsProject(): ProjectEntry {
  const chatsPath = path.join(homedir(), ".local-studio");
  mkdirSync(chatsPath, { recursive: true });
  return withMeta({
    id: CHATS_PROJECT_ID,
    name: "Chats",
    path: chatsPath,
    addedAt: "1970-01-01T00:00:00.000Z",
  });
}

export function listProjectsFromStore(): ProjectEntry[] {
  const projects = withStoreLock((filePath) => readSnapshot(filePath)?.document.projects ?? []);
  return [
    chatsProject(),
    ...projects.filter((project) => project.id !== CHATS_PROJECT_ID).map(withMeta),
  ];
}

export function addProjectToStore(rawPath: string): ProjectEntry {
  const projectPath = resolveAllowedWorkspace(rawPath);
  const record = withStoreLock((filePath) => {
    const document = readSnapshot(filePath)?.document ?? { projects: [] };
    const key = projectPathKey(projectPath);
    const existing = document.projects.find((project) => projectPathKey(project.path) === key);
    if (existing) return existing;
    const added = {
      id: `proj-${randomUUID()}`,
      name: path.basename(projectPath) || projectPath,
      path: projectPath,
      addedAt: new Date().toISOString(),
    };
    writeDocument(filePath, { projects: [added, ...document.projects] });
    return added;
  });
  return withMeta(record);
}

export function removeProjectFromStore(id: string): void {
  if (id === CHATS_PROJECT_ID) return;
  withStoreLock((filePath) => {
    const document = readSnapshot(filePath)?.document ?? { projects: [] };
    const projects = document.projects.filter((project) => project.id !== id);
    if (projects.length !== document.projects.length) writeDocument(filePath, { projects });
  });
}

function canonicalDirectory(rawPath: string): string {
  const resolved = realpathSync.native(rawPath);
  if (!statSync(resolved).isDirectory()) throw new Error(`Path is not a directory: ${rawPath}`);
  return resolved;
}

export function allowedWorkspaceRoots(): string[] {
  const configured = process.env.WORKSPACE_ROOTS?.split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const roots = configured?.length ? configured : [homedir()];
  return [...new Set(roots.map(canonicalDirectory))];
}

export function resolveAllowedWorkspace(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("path is required");
  const candidate = canonicalDirectory(trimmed);
  const allowed = allowedWorkspaceRoots().some((root) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  });
  if (!allowed) throw new Error("Path is outside WORKSPACE_ROOTS");
  return candidate;
}
