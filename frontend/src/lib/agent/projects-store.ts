import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
}

interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

interface ProjectsDocument {
  readonly projects: ProjectRecord[];
}

function projectsFilePath(): string {
  // Anchor at <repo>/data/agentfs/projects.json (mirror existing agentfs pattern).
  return path.resolve(process.cwd(), "..", "data", "agentfs", "projects.json");
}

function readDocument(filePath: string): ProjectsDocument {
  try {
    if (!existsSync(filePath)) return { projects: [] };
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      return { projects: [] };
    }
    const projects = (parsed as { projects: unknown[] }).projects.filter(
      (entry): entry is ProjectRecord =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as ProjectRecord).id === "string" &&
        typeof (entry as ProjectRecord).path === "string" &&
        typeof (entry as ProjectRecord).name === "string" &&
        typeof (entry as ProjectRecord).addedAt === "string",
    );
    return { projects };
  } catch {
    return { projects: [] };
  }
}

function writeDocument(filePath: string, document: ProjectsDocument): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function basenameOf(candidate: string): string {
  const trimmed = candidate.replace(/\/+$/, "");
  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmed || candidate;
}

function gitBranchFor(projectPath: string): string | null {
  const headFile = path.join(projectPath, ".git", "HEAD");
  try {
    if (!existsSync(headFile)) return null;
    const head = readFileSync(headFile, "utf8").trim().split("\n")[0] ?? "";
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (match && match[1]) return match[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);
    return null;
  } catch {
    return null;
  }
}

function newProjectId(): string {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function withMeta(record: ProjectRecord): ProjectEntry {
  return {
    ...record,
    exists: isExistingDirectory(record.path),
    hasGit: existsSync(path.join(record.path, ".git")),
    branch: gitBranchFor(record.path),
  };
}

export function listProjectsFromStore(): ProjectEntry[] {
  return readDocument(projectsFilePath()).projects.map(withMeta);
}

export function addProjectToStore(rawPath: string): ProjectEntry {
  const trimmed = rawPath.trim().replace(/\/+$/, "") || rawPath.trim();
  if (!trimmed) throw new Error("path is required");
  if (!isExistingDirectory(trimmed)) {
    throw new Error(`Path is not a directory: ${trimmed}`);
  }
  const filePath = projectsFilePath();
  const document = readDocument(filePath);
  const existing = document.projects.find((entry) => entry.path === trimmed);
  if (existing) return withMeta(existing);
  const record: ProjectRecord = {
    id: newProjectId(),
    name: basenameOf(trimmed),
    path: trimmed,
    addedAt: new Date().toISOString(),
  };
  writeDocument(filePath, { projects: [record, ...document.projects] });
  return withMeta(record);
}

export function removeProjectFromStore(id: string): void {
  const filePath = projectsFilePath();
  const document = readDocument(filePath);
  if (!document.projects.some((entry) => entry.id === id)) return;
  writeDocument(filePath, {
    projects: document.projects.filter((entry) => entry.id !== id),
  });
}
