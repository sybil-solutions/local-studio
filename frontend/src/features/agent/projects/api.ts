import { Schema } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import type { GitState } from "@/features/agent/contracts";
import { ProjectSchema, type GitSummary, type Project } from "@/features/agent/projects/types";

const ProjectsResponseSchema = Schema.Struct({ projects: Schema.Array(ProjectSchema) });
const ProjectResponseSchema = Schema.Struct({ project: ProjectSchema });
const ErrorResponseSchema = Schema.Struct({ error: Schema.optional(Schema.String) });

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ErrorResponseSchema)(body).error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadProjects(): Promise<Project[]> {
  const response = await fetch("/api/agent/projects", { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, "Failed to load projects"));
  return [...Schema.decodeUnknownSync(ProjectsResponseSchema)(body).projects];
}

export async function openProjectDirectory(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const picker = window.localStudioDesktop?.openDirectory;
  return typeof picker === "function" ? picker() : null;
}

export async function addProjectFromPath(path: string): Promise<Project> {
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, "Failed to add project"));
  return Schema.decodeUnknownSync(ProjectResponseSchema)(body).project;
}

export async function removeProject(id: string): Promise<void> {
  const response = await fetch(`/api/agent/projects?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(responseError(body, "Failed to remove project"));
  }
}

export async function loadGitSummary(cwd: string): Promise<GitSummary | null> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<GitState>(response);
  return {
    isRepo: payload.isRepo === true,
    branch: payload.branch ?? null,
    additions: payload.additions ?? 0,
    deletions: payload.deletions ?? 0,
    statusCount: payload.status?.length ?? 0,
  };
}

export async function initGit(cwd: string): Promise<void> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "init" }),
  });
  if (!response.ok) {
    const payload = await safeJson<{ error?: string }>(response);
    throw new Error(payload.error || "Failed to initialize git repository");
  }
}
