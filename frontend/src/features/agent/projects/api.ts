import { safeJson } from "@/features/agent/safe-json";
import type { GitState } from "@/features/agent/contracts";
import type { GitSummary, Project } from "@/features/agent/projects/types";

type DesktopBridge = {
  openDirectory?: () => Promise<Project | null>;
  listProjects?: () => Promise<Project[]>;
  removeProject?: (id: string) => Promise<{ ok: true }>;
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { localStudioDesktop?: Partial<DesktopBridge> })
    .localStudioDesktop;
  if (!candidate) return null;
  const hasBridgeMethod =
    typeof candidate.openDirectory === "function" ||
    typeof candidate.listProjects === "function" ||
    typeof candidate.removeProject === "function";
  return hasBridgeMethod ? (candidate as DesktopBridge) : null;
}

export async function loadProjects(): Promise<Project[]> {
  const bridge = getDesktopBridge();
  if (bridge?.listProjects) return bridge.listProjects();
  const response = await fetch("/api/agent/projects", { cache: "no-store" });
  const payload = (await response.json()) as { projects?: Project[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Failed to load projects");
  return payload.projects ?? [];
}

export async function openProjectDirectory(): Promise<Project | null> {
  const bridge = getDesktopBridge();
  return bridge?.openDirectory ? bridge.openDirectory() : null;
}

export async function addProjectFromPath(path: string): Promise<Project> {
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const payload = (await response.json()) as { project?: Project; error?: string };
  if (!response.ok || !payload.project) {
    throw new Error(payload.error || "Failed to add project");
  }
  return payload.project;
}

export async function removeProject(id: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.removeProject) {
    await bridge.removeProject(id);
    return;
  }
  const response = await fetch(`/api/agent/projects?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Failed to remove project");
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
