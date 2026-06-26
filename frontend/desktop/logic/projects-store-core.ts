import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "../helpers/fs-json";

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  addedAt: string;
}

export interface ProjectEntry extends ProjectRecord {
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
}

interface ProjectsDocument {
  readonly projects: ProjectRecord[];
}

export interface ProjectsStoreOptions {
  /** Resolved on every operation so env/Electron path changes keep applying. */
  projectsFilePath: () => string;
  /** Id of the synthetic "Chats" project pinned to the top of the list. */
  chatsProjectId: string;
  /** Error message thrown when addProject receives a blank path. */
  emptyPathMessage: string;
}

export interface ProjectsStore {
  listProjects(): ProjectEntry[];
  addProject(rawPath: string): ProjectEntry;
  removeProject(id: string): void;
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
  writeJsonAtomic(filePath, document, 2);
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

/**
 * Shared projects.json store used by both the web app (src/features/agent/
 * projects-store.ts) and the Electron main process (desktop/logic/
 * projects-store.ts). Hosted under desktop/ because the desktop build
 * (tsc rootDir = desktop/) cannot import from src/.
 */
export function createProjectsStore(options: ProjectsStoreOptions): ProjectsStore {
  const { projectsFilePath, chatsProjectId, emptyPathMessage } = options;

  function chatsProject(): ProjectEntry {
    const chatsPath = path.join(homedir(), ".local-studio");
    mkdirSync(chatsPath, { recursive: true });
    return withMeta({
      id: chatsProjectId,
      name: "Chats",
      path: chatsPath,
      addedAt: "1970-01-01T00:00:00.000Z",
    });
  }

  function listProjects(): ProjectEntry[] {
    const projects = readDocument(projectsFilePath())
      .projects.filter((project) => project.id !== chatsProjectId)
      .map(withMeta);
    return [chatsProject(), ...projects];
  }

  function addProject(rawPath: string): ProjectEntry {
    const trimmed = rawPath.trim().replace(/\/+$/, "") || rawPath.trim();
    if (!trimmed) throw new Error(emptyPathMessage);
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

  function removeProject(id: string): void {
    if (id === chatsProjectId) return;
    const filePath = projectsFilePath();
    const document = readDocument(filePath);
    if (!document.projects.some((entry) => entry.id === id)) return;
    writeDocument(filePath, {
      projects: document.projects.filter((entry) => entry.id !== id),
    });
  }

  return { listProjects, addProject, removeProject };
}
