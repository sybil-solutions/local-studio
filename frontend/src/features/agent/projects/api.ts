import { safeJson } from "@/features/agent/safe-json";
import type { GitAction, GitBranch, GitState, GitWorktree } from "@/features/agent/contracts";
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

export type OpenProjectDirectoryResult =
  | { source: "desktop"; project: Project | null }
  | { source: "fallback" };

export async function openProjectDirectory(): Promise<OpenProjectDirectoryResult> {
  const bridge = getDesktopBridge();
  if (!bridge?.openDirectory) return { source: "fallback" };
  return { source: "desktop", project: await bridge.openDirectory() };
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

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  const response = await fetch(`/api/agent/git/branches?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<{ branches?: GitBranch[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to list branches");
  return payload.branches ?? [];
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const response = await fetch(`/api/agent/git/worktrees?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<{ worktrees?: GitWorktree[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to list worktrees");
  return payload.worktrees ?? [];
}

export async function runGitAction(cwd: string, action: GitAction): Promise<void> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    const payload = await safeJson<{ error?: string }>(response);
    throw new Error(payload.error || "Git operation failed");
  }
}

export async function switchBranch(cwd: string, branch: string): Promise<void> {
  await runGitAction(cwd, { action: "switch_branch", branch });
}

export async function createBranch(cwd: string, branch: string): Promise<void> {
  await runGitAction(cwd, { action: "create_branch", branch });
}

export async function addWorktree(cwd: string, branch: string, path: string): Promise<void> {
  await runGitAction(cwd, { action: "add_worktree", branch, path });
}

export async function removeWorktree(cwd: string, path: string): Promise<void> {
  await runGitAction(cwd, { action: "remove_worktree", path });
}
