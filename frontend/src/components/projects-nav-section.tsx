"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageSquare, Plus } from "lucide-react";

type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  turnCount: number;
};

const SESSIONS_PER_PROJECT = 10;
const DIRECTORY_PICKER_PROPS = { webkitdirectory: "" } as Record<string, string>;

type DesktopBridge = {
  openDirectory: () => Promise<ProjectEntry | null>;
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { vllmStudioDesktop?: Partial<DesktopBridge> })
    .vllmStudioDesktop;
  if (!candidate || typeof candidate.openDirectory !== "function") return null;
  return candidate as DesktopBridge;
}

function formatRelative(isoString: string): string {
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Collapsible PROJECTS section in the top-level left sidebar. Each project is
 * a folder; expanding it fetches and lists the recent sessions inside.
 *
 * Hidden when the sidebar is collapsed to its icon rail (caller decides via
 * `expanded`).
 */
export function ProjectsNavSection({ expanded }: { expanded: boolean }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/projects", { cache: "no-store" });
      const payload = (await response.json()) as { projects?: ProjectEntry[] };
      setProjects(payload.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  const upsertProject = useCallback((project: ProjectEntry) => {
    setProjects((current) => [project, ...current.filter((entry) => entry.id !== project.id)]);
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/agent/projects", { cache: "no-store" });
        const payload = (await response.json()) as { projects?: ProjectEntry[] };
        if (!cancelled) setProjects(payload.projects ?? []);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  if (!expanded) return null;

  const addProjectFromPath = async (directoryPath: string): Promise<ProjectEntry> => {
    const response = await fetch("/api/agent/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: directoryPath }),
    });
    const payload = (await response.json()) as { project?: ProjectEntry; error?: string };
    if (!response.ok || !payload.project) {
      throw new Error(payload.error || "Failed to add project");
    }
    return payload.project;
  };

  const handleAddProject = async () => {
    setAddError("");
    const desktopBridge = getDesktopBridge();
    if (desktopBridge) {
      try {
        const project = await desktopBridge.openDirectory();
        if (project) upsertProject(project);
      } catch (error) {
        setAddError(error instanceof Error ? error.message : "Failed to add project");
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFolderSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    setAddError("");
    const firstFile = event.target.files?.[0];
    event.target.value = "";
    if (!firstFile) return;
    const selectedPath = (firstFile as File & { path?: string }).path;
    const relativeRoot = firstFile.webkitRelativePath.split("/")[0] ?? "";
    const directoryPath =
      selectedPath && relativeRoot
        ? selectedPath.slice(0, selectedPath.lastIndexOf(relativeRoot) + relativeRoot.length)
        : selectedPath;
    if (!directoryPath) {
      setAddError("This browser does not expose a selectable folder path.");
      return;
    }
    try {
      const project = await addProjectFromPath(directoryPath);
      upsertProject(project);
      void loadProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
    }
  };

  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col">
      <div className="mt-2 flex h-7 items-center px-3 text-[10px] font-medium uppercase tracking-wide text-(--dim)">
        Projects
      </div>
      <input
        {...DIRECTORY_PICKER_PROPS}
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderSelection}
      />
      <button
        type="button"
        onClick={handleAddProject}
        className="h-9 flex items-center gap-2 px-3 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
      >
        <Plus className="w-4 h-4 shrink-0" />
        <span className="truncate text-sm font-medium text-(--fg)">Add project</span>
      </button>
      {projects.length === 0 ? (
        <button
          type="button"
          onClick={handleAddProject}
          className="px-3 py-1.5 text-left text-[11px] text-(--dim) hover:text-(--fg)"
        >
          No projects yet — pick a folder to get started.
        </button>
      ) : (
        projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            open={openIds.has(project.id)}
            onToggle={() => toggle(project.id)}
          />
        ))
      )}
      {addError ? <div className="px-3 py-1 text-[11px] text-red-400">{addError}</div> : null}
    </div>
  );
}

function ProjectRow({
  project,
  open,
  onToggle,
}: {
  project: ProjectEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = open ? FolderOpen : Folder;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        title={project.path}
        className="h-9 flex items-center gap-2 px-3 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
      >
        <Chevron className="w-3 h-3 shrink-0" />
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate text-sm font-medium text-(--fg)">{project.name}</span>
      </button>
      {open ? <ProjectSessions project={project} /> : null}
    </div>
  );
}

function ProjectSessions({ project }: { project: ProjectEntry }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/agent/sessions?cwd=${encodeURIComponent(project.path)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { sessions?: SessionSummary[] };
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = (sessions ?? []).slice(0, SESSIONS_PER_PROJECT);
  const extra = (sessions?.length ?? 0) - visible.length;

  return (
    <div className="flex flex-col">
      <Link
        href={`/agent?project=${encodeURIComponent(project.id)}&new=1`}
        className="h-8 flex items-center gap-2 pl-9 pr-3 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
        title="Start a new chat in this project"
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-xs">New thread</span>
      </Link>
      {loading && !sessions ? (
        <div className="pl-9 pr-3 py-1 text-[11px] text-(--dim)">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="pl-9 pr-3 py-1 text-[11px] text-(--dim)">No sessions yet.</div>
      ) : (
        visible.map((session) => (
          <Link
            key={session.id}
            href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}`}
            title={session.firstUserMessage || "Untitled session"}
            className="h-8 flex items-center gap-2 pl-9 pr-3 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-xs">
              {session.firstUserMessage || "Untitled session"}
            </span>
            <span className="shrink-0 text-[10px] text-(--dim)">
              {formatRelative(session.updatedAt)}
            </span>
          </Link>
        ))
      )}
      {extra > 0 ? (
        <Link
          href={`/agent?project=${encodeURIComponent(project.id)}`}
          className="h-7 flex items-center pl-9 pr-3 text-[11px] text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
        >
          + {extra} more
        </Link>
      ) : null}
    </div>
  );
}
