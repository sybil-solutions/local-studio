"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  ChatIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeOffIcon,
  Folder,
  FolderOpen,
  MoreIcon,
  PinIcon,
  PinSlashIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons";

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

const DIRECTORY_PICKER_PROPS = { webkitdirectory: "" } as Record<string, string>;
const ADD_PROJECT_EVENT = "vllm-studio.agent.addProject";
export const SESSIONS_CHANGED_EVENT = "vllm-studio.agent.sessionsChanged";
export const PROJECTS_CHANGED_EVENT = "vllm-studio.agent.projectsChanged";
export const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";

type ActiveAgentSession = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  updatedAt: string;
};

type SessionPref = {
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
};

const SESSION_PREFS_KEY = "vllm-studio.agent.sessionPrefs";
const SHOW_HIDDEN_KEY = "vllm-studio.agent.sessionPrefs.showHidden";
const SESSION_PREFS_CHANGED_EVENT = "vllm-studio.agent.sessionPrefs.changed";
const ACTIVE_AGENT_SESSIONS_KEY = "vllm-studio.agent.activeSessions.snapshot";

function loadActiveAgentSessions(): ActiveAgentSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVE_AGENT_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ActiveAgentSession[]) : [];
  } catch {
    return [];
  }
}

function saveActiveAgentSessions(sessions: ActiveAgentSession[]) {
  if (typeof window === "undefined") return;
  if (sessions.length === 0) {
    window.localStorage.removeItem(ACTIVE_AGENT_SESSIONS_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_AGENT_SESSIONS_KEY, JSON.stringify(sessions));
}

function loadSessionPrefs(): Record<string, SessionPref> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, SessionPref>) : {};
  } catch {
    return {};
  }
}

function saveSessionPrefs(prefs: Record<string, SessionPref>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
}

function removeSessionPref(piSessionId: string) {
  const all = loadSessionPrefs();
  delete all[piSessionId];
  saveSessionPrefs(all);
}

function patchSessionPref(piSessionId: string, patch: SessionPref) {
  const all = loadSessionPrefs();
  const current = all[piSessionId] ?? {};
  const next: SessionPref = { ...current, ...patch };
  // Normalize: drop the entry entirely if all flags are cleared so we don't
  // grow localStorage forever.
  if (!next.title && !next.pinned && !next.hidden) {
    delete all[piSessionId];
  } else {
    all[piSessionId] = next;
  }
  saveSessionPrefs(all);
}

function useSessionPrefs() {
  const [prefs, setPrefs] = useState<Record<string, SessionPref>>(() => loadSessionPrefs());
  useEffect(() => {
    const refresh = () => setPrefs(loadSessionPrefs());
    refresh();
    window.addEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return prefs;
}

export function triggerAddProjectFlow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
}

function notifyProjectsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

type DesktopBridge = {
  openDirectory?: () => Promise<ProjectEntry | null>;
  getPathForFile?: (file: File) => string;
  listProjects?: () => Promise<ProjectEntry[]>;
  removeProject?: (id: string) => Promise<{ ok: true }>;
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { vllmStudioDesktop?: Partial<DesktopBridge> })
    .vllmStudioDesktop;
  if (!candidate) return null;
  const hasBridgeMethod =
    typeof candidate.openDirectory === "function" ||
    typeof candidate.getPathForFile === "function" ||
    typeof candidate.listProjects === "function" ||
    typeof candidate.removeProject === "function";
  if (!hasBridgeMethod) return null;
  return candidate as DesktopBridge;
}

export async function loadAgentProjects(): Promise<ProjectEntry[]> {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.listProjects) {
    return desktopBridge.listProjects();
  }
  const response = await fetch("/api/agent/projects", { cache: "no-store" });
  const payload = (await response.json()) as { projects?: ProjectEntry[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Failed to load projects");
  return payload.projects ?? [];
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
  const [activeSessions, setActiveSessions] = useState<ActiveAgentSession[]>(() =>
    loadActiveAgentSessions(),
  );
  const [addError, setAddError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await loadAgentProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  const upsertProject = useCallback((project: ProjectEntry) => {
    setProjects((current) => [project, ...current.filter((entry) => entry.id !== project.id)]);
    notifyProjectsChanged();
  }, []);

  const removeProject = useCallback(async (id: string) => {
    const desktopBridge = getDesktopBridge();
    if (desktopBridge?.removeProject) {
      await desktopBridge.removeProject(id);
    } else {
      const response = await fetch(`/api/agent/projects?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to remove project");
      }
    }
    setProjects((current) => current.filter((entry) => entry.id !== id));
    notifyProjectsChanged();
    setOpenIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!expanded) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const list = await loadAgentProjects();
        if (!cancelled) setProjects(list);
      } catch {
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

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
    if (desktopBridge?.openDirectory) {
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
    const desktopBridge = getDesktopBridge();
    const selectedPath =
      desktopBridge?.getPathForFile?.(firstFile) || (firstFile as File & { path?: string }).path;
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

  useEffect(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  });

  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveAgentSession[] }>).detail;
      const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
      setActiveSessions(sessions);
      saveActiveAgentSessions(sessions);
      setOpenIds((current) => {
        const next = new Set(current);
        for (const session of sessions) next.add(session.projectId);
        return next;
      });
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
  }, []);

  if (!expanded) {
    return (
      <input
        {...DIRECTORY_PICKER_PROPS}
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderSelection}
      />
    );
  }

  return (
    <div className="flex shrink-0 flex-col">
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
        <PlusIcon className="w-3 h-3 shrink-0" />
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
            activeSessions={activeSessions.filter((session) => session.projectId === project.id)}
            onToggle={() => toggle(project.id)}
            onRemove={() => {
              setAddError("");
              void removeProject(project.id).catch((error) => {
                setAddError(error instanceof Error ? error.message : "Failed to remove project");
              });
            }}
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
  onRemove,
  activeSessions,
}: {
  project: ProjectEntry;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  activeSessions: ActiveAgentSession[];
}) {
  const [missingErrorVisible, setMissingErrorVisible] = useState(false);
  const Icon = open ? FolderOpen : Folder;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  const handleToggle = () => {
    if (!project.exists) {
      setMissingErrorVisible(true);
      return;
    }
    setMissingErrorVisible(false);
    onToggle();
  };

  return (
    <div className="flex flex-col">
      <div className="group flex h-9 items-center text-(--dim) hover:bg-(--surface) hover:text-(--fg) transition-colors">
        <button
          type="button"
          onClick={handleToggle}
          title={project.path}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left"
        >
          <Chevron className="w-3 h-3 shrink-0" />
          <Icon className="w-4 h-4 shrink-0" />
          <span className="truncate text-sm font-medium text-(--fg)">{project.name}</span>
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
              title={project.path}
              aria-label={`Folder not found at ${project.path}`}
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="mr-2 rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--surface) hover:text-(--err) group-hover:opacity-100"
          title="Remove from list"
          aria-label="Remove project"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
      {missingErrorVisible && !project.exists ? (
        <div className="pl-9 pr-3 pb-1 text-[11px] text-red-400">
          <span>Folder not found at {project.path}</span>
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 text-(--dim) underline underline-offset-2 hover:text-(--fg)"
          >
            Remove
          </button>
        </div>
      ) : null}
      {open && project.exists ? (
        <ProjectSessions project={project} activeSessions={activeSessions} />
      ) : null}
    </div>
  );
}

function ProjectSessions({
  project,
  activeSessions,
}: {
  project: ProjectEntry;
  activeSessions: ActiveAgentSession[];
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const projectActiveSessions = activeSessions.filter(
    (session) => session.projectId === project.id,
  );
  const activePiSessionIds = new Set(
    projectActiveSessions
      .map((session) => session.piSessionId)
      .filter((id): id is string => Boolean(id)),
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=7d`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as { sessions?: SessionSummary[] };
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      const response = await fetch(
        `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&id=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to delete session");
      }
      removeSessionPref(sessionId);
      setSessions((current) => current?.filter((session) => session.id !== sessionId) ?? current);
    },
    [project.path],
  );

  useEffect(() => {
    void reload();
    window.addEventListener(SESSIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, reload);
  }, [reload]);

  const prefs = useSessionPrefs();
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_HIDDEN_KEY) === "1";
  });
  const toggleShowHidden = () =>
    setShowHidden((value) => {
      const next = !value;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SHOW_HIDDEN_KEY, next ? "1" : "0");
      }
      return next;
    });

  const visibleActiveSessions = projectActiveSessions.filter((session) => {
    if (!session.piSessionId) return true;
    return showHidden || !prefs[session.piSessionId]?.hidden;
  });

  const allRecent = (sessions ?? []).filter((session) => !activePiSessionIds.has(session.id));
  const pinned: SessionSummary[] = [];
  const recent: SessionSummary[] = [];
  const hidden: SessionSummary[] = [];
  for (const session of allRecent) {
    const pref = prefs[session.id] ?? {};
    if (pref.hidden) hidden.push(session);
    else if (pref.pinned) pinned.push(session);
    else recent.push(session);
  }

  return (
    <div className="flex flex-col">
      <Link
        href={`/agent?project=${encodeURIComponent(project.id)}&new=1`}
        className="h-8 flex items-center gap-2 pl-9 pr-3 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
        title="Start a new chat in this project"
      >
        <PlusIcon className="w-3 h-3 shrink-0" />
        <span className="truncate text-xs">New session</span>
      </Link>

      {visibleActiveSessions.map((session) => (
        <ActiveSessionRow
          key={`${session.paneId}:${session.tabId}`}
          project={project}
          session={session}
          pref={session.piSessionId ? (prefs[session.piSessionId] ?? {}) : {}}
          onDelete={deleteSessionById}
        />
      ))}

      {loading && !sessions ? (
        <div className="pl-9 pr-3 py-1 text-[11px] text-(--dim)">Loading…</div>
      ) : allRecent.length === 0 && visibleActiveSessions.length === 0 ? (
        <div className="pl-9 pr-3 py-1 text-[11px] text-(--dim)">No recent sessions</div>
      ) : (
        <>
          {pinned.length > 0 ? (
            <div className="pl-9 pr-3 pt-1 text-[9px] font-medium uppercase tracking-wide text-(--dim)">
              Pinned
            </div>
          ) : null}
          {pinned.map((session) => (
            <SessionRow
              key={session.id}
              project={project}
              session={session}
              pref={prefs[session.id] ?? {}}
              onDelete={deleteSessionById}
            />
          ))}
          {recent.length > 0 && pinned.length > 0 ? (
            <div className="pl-9 pr-3 pt-1 text-[9px] font-medium uppercase tracking-wide text-(--dim)">
              Recent
            </div>
          ) : null}
          {recent.map((session) => (
            <SessionRow
              key={session.id}
              project={project}
              session={session}
              pref={prefs[session.id] ?? {}}
              onDelete={deleteSessionById}
            />
          ))}
          {hidden.length > 0 ? (
            <button
              type="button"
              onClick={toggleShowHidden}
              className="h-7 flex items-center gap-2 pl-9 pr-3 text-[10px] text-(--dim) hover:text-(--fg) hover:bg-(--surface)"
              title={showHidden ? "Hide hidden sessions" : "Show hidden sessions"}
            >
              <EyeOffIcon className="w-3 h-3 shrink-0" />
              {showHidden ? `Hide ${hidden.length} hidden` : `Show ${hidden.length} hidden`}
            </button>
          ) : null}
          {showHidden
            ? hidden.map((session) => (
                <SessionRow
                  key={session.id}
                  project={project}
                  session={session}
                  pref={prefs[session.id] ?? {}}
                  onDelete={deleteSessionById}
                />
              ))
            : null}
        </>
      )}
    </div>
  );
}

function ActiveSessionRow({
  project,
  session,
  pref,
  onDelete,
}: {
  project: ProjectEntry;
  session: ActiveAgentSession;
  pref: SessionPref;
  onDelete: (sessionId: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(pref.title ?? session.title ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = pref.title || session.title || "Current session";

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const finishRename = () => {
    const trimmed = draft.trim();
    if (session.piSessionId) patchSessionPref(session.piSessionId, { title: trimmed || undefined });
    setRenaming(false);
  };

  if (renaming && session.piSessionId) {
    return (
      <div className="h-8 flex items-center gap-2 pl-9 pr-3 text-(--fg) bg-(--surface)/60">
        <ChatIcon className="w-3 h-3 shrink-0 text-(--accent)" />
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(pref.title ?? session.title ?? "");
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-xs text-(--fg) outline-none"
        />
      </div>
    );
  }

  const content = (
    <>
      <ChatIcon className="w-3 h-3 shrink-0 text-(--accent)" />
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      <span className="shrink-0 text-[10px] text-(--accent)">
        {session.status === "idle" ? "current" : session.status}
      </span>
    </>
  );

  if (!session.piSessionId) {
    return (
      <div
        title={label}
        className="h-8 flex items-center gap-2 pl-9 pr-3 text-(--fg) bg-(--surface)/60"
      >
        {content}
      </div>
    );
  }

  const activeSessionId = session.piSessionId;

  return (
    <div className="group h-8 flex items-center gap-2 pl-9 pr-2 text-(--fg) bg-(--surface)/60 hover:bg-(--surface) transition-colors">
      <Link
        href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(activeSessionId)}`}
        title={label}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-vllm-session", activeSessionId ?? "");
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          setDraft(pref.title ?? session.title ?? "");
          setRenaming(true);
        }}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        {content}
      </Link>
      <Link
        href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(activeSessionId)}&split=1`}
        className="rounded px-1 text-[10px] text-(--dim) opacity-0 hover:bg-(--bg) hover:text-(--fg) group-hover:opacity-100"
        title="Open beside focused session"
      >
        Split
      </Link>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className="rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--bg) hover:text-(--fg) group-hover:opacity-100"
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className="h-3 w-3" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-5 z-50 min-w-[150px] rounded-md border border-(--border) bg-(--bg) p-1 text-xs shadow-lg">
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                setDraft(pref.title ?? session.title ?? "");
                setRenaming(true);
              }}
            >
              Rename
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                patchSessionPref(activeSessionId, { pinned: !pref.pinned });
              }}
            >
              {pref.pinned ? "Unpin" : "Pin"}
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                patchSessionPref(activeSessionId, { hidden: !pref.hidden });
              }}
            >
              {pref.hidden ? "Unarchive" : "Archive"}
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm("Delete this session from disk?")) {
                  void onDelete(activeSessionId);
                }
              }}
            >
              <span className="text-(--err)">Delete</span>
            </SessionMenuItem>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionRow({
  project,
  session,
  pref,
  onDelete,
}: {
  project: ProjectEntry;
  session: SessionSummary;
  pref: SessionPref;
  onDelete: (sessionId: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(pref.title ?? session.firstUserMessage ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const label = pref.title || session.firstUserMessage || "Untitled session";

  const finishRename = () => {
    const trimmed = draft.trim();
    patchSessionPref(session.id, { title: trimmed || undefined });
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="h-8 flex items-center gap-2 pl-9 pr-3 bg-(--surface)/60">
        <ChatIcon className="w-3 h-3 shrink-0 text-(--dim)" />
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(pref.title ?? session.firstUserMessage ?? "");
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-xs text-(--fg) outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className="group h-8 flex items-center gap-2 pl-9 pr-2 text-(--dim) hover:text-(--fg) hover:bg-(--surface) transition-colors"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <Link
        href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}`}
        title={label}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-vllm-session", session.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        {pref.pinned ? (
          <PinIcon className="w-3 h-3 shrink-0 text-(--accent)" />
        ) : (
          <ChatIcon className="w-3 h-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
        <span className="shrink-0 text-[10px] text-(--dim)">
          {formatRelative(session.updatedAt)}
        </span>
      </Link>
      <div ref={menuRef} className="relative shrink-0">
        <Link
          href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}&split=1`}
          className="rounded px-1 text-[10px] text-(--dim) opacity-0 hover:bg-(--bg) hover:text-(--fg) group-hover:opacity-100"
          title="Open beside focused session"
        >
          Split
        </Link>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className="rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--bg) hover:text-(--fg) group-hover:opacity-100"
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className="h-3 w-3" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-5 z-50 min-w-[140px] rounded-md border border-(--border) bg-(--bg) p-1 text-xs shadow-lg">
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                setDraft(pref.title ?? session.firstUserMessage ?? "");
                setRenaming(true);
              }}
            >
              Rename
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                patchSessionPref(session.id, { pinned: !pref.pinned });
              }}
            >
              {pref.pinned ? (
                <span className="inline-flex items-center gap-2">
                  <PinSlashIcon className="h-3 w-3" /> Unpin
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <PinIcon className="h-3 w-3" /> Pin
                </span>
              )}
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                patchSessionPref(session.id, { hidden: !pref.hidden });
              }}
            >
              <span className="inline-flex items-center gap-2">
                <EyeOffIcon className="h-3 w-3" /> {pref.hidden ? "Unarchive" : "Archive"}
              </span>
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm("Delete this session from disk?")) {
                  void onDelete(session.id);
                }
              }}
            >
              <span className="inline-flex items-center gap-2 text-(--err)">
                <TrashIcon className="h-3 w-3" /> Delete
              </span>
            </SessionMenuItem>
            {pref.title || pref.pinned || pref.hidden ? (
              <SessionMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  patchSessionPref(session.id, {
                    title: undefined,
                    pinned: undefined,
                    hidden: undefined,
                  });
                }}
              >
                <span className="inline-flex items-center gap-2 text-(--err)">
                  <CloseIcon className="h-3 w-3" /> Clear
                </span>
              </SessionMenuItem>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionMenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded px-2 py-1 text-left text-xs text-(--fg) hover:bg-(--surface)"
    >
      {children}
    </button>
  );
}
