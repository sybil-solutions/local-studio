"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  CloseIcon,
  ChatIcon,
  ChevronDownIcon,
  EyeOffIcon,
  Folder,
  FolderOpen,
  MoreIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons";
import { Button, UiModal, UiModalHeader } from "@/components/ui-kit";
import { safeJson } from "@/lib/agent/safe-json";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import {
  ACTIVE_AGENT_SESSION_OPEN_EVENT,
  ACTIVE_AGENT_SESSION_RENAME_EVENT,
  ACTIVE_AGENT_SESSIONS_EVENT,
  ADD_PROJECT_EVENT,
  NEW_AGENT_SESSION_EVENT,
  PROJECTS_CHANGED_EVENT,
  SESSION_PREFS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/agent/workspace/events";
import {
  loadPersistedActiveAgentSessions,
  persistActiveAgentSessions,
} from "@/lib/agent/workspace/store";
import { useProjects } from "@/lib/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/lib/agent/projects/api";
import { useClickOutside } from "@/hooks/use-click-outside";
import {
  loadSessionPrefs,
  patchSessionPref,
  hydrateSessionPrefsFromDesktop,
  type SessionPref,
  type SessionPrefs,
} from "@/lib/agent/session/prefs";
import { isChatsProject, type Project as ProjectEntry } from "@/lib/agent/projects/types";
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
type PinnedSession = SessionSummary & { project: ProjectEntry };
type DirectoryBrowserEntry = { name: string; path: string };
type DirectoryBrowserPayload = {
  path: string;
  parent: string | null;
  home: string;
  entries: DirectoryBrowserEntry[];
  error?: string;
};
type ActiveAgentSession = ActiveAgentSessionSnapshot;
const SHOW_HIDDEN_KEY = "vllm-studio.agent.sessionPrefs.showHidden";
const SESSION_NAV_TITLE_PREFIX = "vllm-studio.agent.sessionNavTitle:";
const SESSION_MENU_CLASS =
  "absolute right-0 top-5 z-50 min-w-[150px] rounded-md border border-(--border) bg-[#151515] p-1 text-xs text-(--fg) shadow-[0_8px_28px_rgba(0,0,0,0.65)]";
function setAgentSessionDragData(
  event: DragEvent,
  session: {
    piSessionId?: string | null;
    projectId?: string;
    cwd?: string;
    paneId?: string;
    tabId?: string;
    title?: string;
  },
) {
  if (session.piSessionId) {
    event.dataTransfer.setData("application/x-vllm-session", session.piSessionId);
  }
  event.dataTransfer.setData("application/x-vllm-agent-session", JSON.stringify(session));
  event.dataTransfer.effectAllowed = "copy";
}
function activeSessionPrefKeys(session: ActiveAgentSession): string[] {
  return [
    session.piSessionId,
    session.paneId && session.tabId ? `tab:${session.paneId}:${session.tabId}` : null,
  ].filter((value): value is string => Boolean(value));
}
function activeSessionPref(session: ActiveAgentSession, prefs: SessionPrefs): SessionPref {
  return activeSessionPrefKeys(session).reduce<SessionPref>(
    (merged, key) => ({ ...merged, ...(prefs[key] ?? {}) }),
    {},
  );
}
function patchActiveSessionPref(session: ActiveAgentSession, patch: SessionPref) {
  for (const key of activeSessionPrefKeys(session)) patchSessionPref(key, patch);
}
function relativeAge(value?: string | null): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}
function sessionDedupeKey(session: SessionSummary): string {
  const label = (session.firstUserMessage || "Untitled session")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${label}:${relativeAge(session.startedAt)}`;
}
function useSessionPrefs() {
  const [prefs, setPrefs] = useState<SessionPrefs>(() => loadSessionPrefs());
  useEffect(() => {
    void hydrateSessionPrefsFromDesktop();
    const refresh = () =>
      setPrefs((current) => {
        const next = loadSessionPrefs();
        try {
          if (JSON.stringify(current) === JSON.stringify(next)) return current;
        } catch {}
        return next;
      });
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
export function rememberAgentSessionNavTitle(sessionId: string | null | undefined, title: string) {
  if (typeof window === "undefined" || !sessionId) return;
  const trimmed = title.trim();
  if (!trimmed || trimmed === "Loading session") return;
  try {
    window.sessionStorage.setItem(`${SESSION_NAV_TITLE_PREFIX}${sessionId}`, trimmed);
  } catch {
    return;
  }
}
export function consumeAgentSessionNavTitle(sessionId: string | null | undefined) {
  if (typeof window === "undefined" || !sessionId) return undefined;
  const key = `${SESSION_NAV_TITLE_PREFIX}${sessionId}`;
  try {
    const title = window.sessionStorage.getItem(key)?.trim() || undefined;
    window.sessionStorage.removeItem(key);
    return title;
  } catch {
    return undefined;
  }
}
function ProjectDirectoryPickerModal({
  open,
  error,
  onClose,
  onSelect,
}: {
  open: boolean;
  error: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState("");
  const [entries, setEntries] = useState<DirectoryBrowserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const loadDirectory = useCallback(async (directoryPath?: string) => {
    setLoading(true);
    setBrowseError("");
    try {
      const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : "";
      const response = await fetch(`/api/agent/directories${query}`, { cache: "no-store" });
      const payload = (await response.json()) as DirectoryBrowserPayload;
      if (!response.ok) throw new Error(payload.error || "Failed to list directories");
      setCurrentPath(payload.path);
      setDraftPath(payload.path);
      setParentPath(payload.parent);
      setHomePath(payload.home);
      setEntries(payload.entries ?? []);
    } catch (loadError) {
      setBrowseError(loadError instanceof Error ? loadError.message : "Failed to list directories");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    void loadDirectory();
  }, [open, loadDirectory]);
  const goToDraftPath = () => {
    const next = draftPath.trim();
    if (next) void loadDirectory(next);
  };
  return (
    <UiModal isOpen={open} onClose={onClose} maxWidth="max-w-3xl">
      {" "}
      <UiModalHeader
        title="Add project folder"
        icon={<Folder className="h-4 w-4" />}
        onClose={onClose}
      />
      <div className="space-y-4 p-5 text-sm text-(--fg)">
        {" "}
        <p className="text-xs leading-5 text-(--dim)">
          Browse folders on the machine running vLLM Studio, or paste an absolute path.
        </p>
        <div className="flex gap-2">
          {" "}
          <input
            value={draftPath}
            onChange={(event) => setDraftPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") goToDraftPath();
            }}
            className="min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-3 py-2 font-mono text-xs text-(--fg) outline-none focus:border-(--accent)"
            placeholder="/Users/name/project"
            aria-label="Directory path"
          />{" "}
          <Button
            variant="secondary"
            onClick={goToDraftPath}
            disabled={loading || !draftPath.trim()}
          >
            Go{" "}
          </Button>
        </div>{" "}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => homePath && void loadDirectory(homePath)}
            disabled={!homePath || loading}
          >
            {" "}
            Home
          </Button>{" "}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => parentPath && void loadDirectory(parentPath)}
            disabled={!parentPath || loading}
          >
            Up{" "}
          </Button>
          <span className="truncate font-mono text-xs text-(--dim)" title={currentPath}>
            {" "}
            {currentPath || "Loading…"}
          </span>{" "}
        </div>
        <div className="h-72 overflow-auto rounded-lg border border-(--border) bg-(--bg)">
          {" "}
          {loading ? (
            <div className="px-3 py-8 text-center text-xs text-(--dim)">Loading folders…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-(--dim)">No subfolders found.</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void loadDirectory(entry.path)}
                className="flex w-full items-center gap-2 border-b border-(--border)/50 px-3 py-2 text-left hover:bg-(--surface)"
                title={entry.path}
              >
                <Folder className="h-4 w-4 shrink-0 text-(--dim)" />{" "}
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}{" "}
        </div>
        {(browseError || error) && (
          <div className="rounded border border-(--err)/30 bg-(--err)/10 px-3 py-2 text-xs text-(--err)">
            {browseError || error}
          </div>
        )}{" "}
        <div className="flex justify-end gap-2 border-t border-(--border) pt-4">
          <Button variant="ghost" onClick={onClose}>
            {" "}
            Cancel
          </Button>{" "}
          <Button
            onClick={() => {
              const selectedPath = draftPath.trim() || currentPath;
              if (selectedPath) onSelect(selectedPath);
            }}
            disabled={!(draftPath.trim() || currentPath) || loading}
          >
            Select this folder{" "}
          </Button>
        </div>{" "}
      </div>
    </UiModal>
  );
}
/** * Collapsible PROJECTS section in the top-level left sidebar. Each project is
 * a folder; expanding it fetches and lists the recent sessions inside. *
 * Hidden when the sidebar is collapsed to its icon rail (caller decides via * `expanded`).
 */ export function ProjectsNavSection({ expanded }: { expanded: boolean }) {
  const projectsContext = useProjects();
  const projects = projectsContext.projects;
  const chatProject = projects.find(isChatsProject) ?? null;
  const fileProjects = projects.filter((project) => !isChatsProject(project));
  const upsertProject = projectsContext.upsertProject;
  const removeProject = projectsContext.removeProject;
  const refreshProjects = projectsContext.refresh;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [activeSessions, setActiveSessions] = useState<ActiveAgentSession[]>(() =>
    loadPersistedActiveAgentSessions(),
  );
  const [addError, setAddError] = useState("");
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false);
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSession[]>([]);
  const prefs = useSessionPrefs();
  const pinnedPrefIds = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([, pref]) => pref.pinned && !pref.hidden)
        .map(([id]) => id)
        .sort(),
    [prefs],
  );
  const hiddenPrefIds = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([, pref]) => pref.hidden)
        .map(([id]) => id)
        .sort(),
    [prefs],
  );
  const activePiSessionIds = useMemo(
    () =>
      activeSessions
        .map((session) => session.piSessionId)
        .filter((id): id is string => Boolean(id))
        .sort(),
    [activeSessions],
  );
  const pinnedPrefIdsKey = pinnedPrefIds.join("\u0000");
  const hiddenPrefIdsKey = hiddenPrefIds.join("\u0000");
  const activePiSessionIdsKey = activePiSessionIds.join("\u0000");
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const pinnedActiveSessions = useMemo(
    () =>
      activeSessions
        .filter((session) => {
          const pref = activeSessionPref(session, prefs);
          return pref.pinned && !pref.hidden;
        })
        .map((session) => ({ session, project: projectsById.get(session.projectId) }))
        .filter((entry): entry is { session: ActiveAgentSession; project: ProjectEntry } =>
          Boolean(entry.project),
        ),
    [activeSessions, prefs, projectsById],
  );
  const pinnedActiveSessionIds = useMemo(
    () =>
      new Set(
        pinnedActiveSessions
          .map(({ session }) => session.piSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [pinnedActiveSessions],
  );
  const pinnedRenderedIds = useMemo(() => {
    const ids = new Set(pinnedActiveSessionIds);
    for (const session of pinnedSessions) ids.add(session.id);
    return ids;
  }, [pinnedActiveSessionIds, pinnedSessions]);
  const removeProjectAndCloseRow = useCallback(
    async (id: string) => {
      await removeProject(id);
      setOpenIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [removeProject],
  );
  const handleAddProject = useCallback(async () => {
    setAddError("");
    try {
      const desktopProject = await openProjectDirectory();
      if (desktopProject) {
        upsertProject(desktopProject);
        return;
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
      return;
    }
    setDirectoryModalOpen(true);
  }, [upsertProject]);
  const handleDirectoryPicked = async (directoryPath: string) => {
    setAddError("");
    try {
      const project = await addProjectFromPath(directoryPath);
      upsertProject(project);
      setDirectoryModalOpen(false);
      void refreshProjects();
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
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  useEffect(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);
  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveAgentSession[] }>).detail;
      const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
      setActiveSessions((current) =>
        sessions.length > 0 ? mergeActiveAgentSessions([], sessions, loadSessionPrefs()) : [],
      );
      persistActiveAgentSessions(sessions);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
  }, []);
  useEffect(() => {
    if (!expanded || projects.length === 0) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    if (!pinnedPrefIdsKey) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    let cancelled = false;
    const pinnedIdsList = pinnedPrefIdsKey.split("\u0000").filter(Boolean);
    const pinnedIds = new Set(pinnedIdsList);
    const hiddenIds = new Set(hiddenPrefIdsKey.split("\u0000").filter(Boolean));
    const idsParam = encodeURIComponent(pinnedIdsList.join(","));
    (async () => {
      const rows = await Promise.all(
        projects.map(async (project) => {
          try {
            const response = await fetch(
              `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=30d&ids=${idsParam}`,
              { cache: "no-store" },
            );
            const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
            return (payload.sessions ?? [])
              .filter((session) => pinnedIds.has(session.id) && !hiddenIds.has(session.id))
              .map((session) => ({ ...session, project }));
          } catch {
            return [];
          }
        }),
      );
      if (!cancelled) {
        setPinnedSessions(
          rows
            .flat()
            .sort(
              (a, b) =>
                new Date(b.startedAt || b.updatedAt).getTime() -
                new Date(a.startedAt || a.updatedAt).getTime(),
            ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePiSessionIdsKey, expanded, hiddenPrefIdsKey, pinnedPrefIdsKey, projects]);
  if (!expanded) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-col">
      {" "}
      <ProjectDirectoryPickerModal
        open={directoryModalOpen}
        error={addError}
        onClose={() => setDirectoryModalOpen(false)}
        onSelect={(directoryPath) => void handleDirectoryPicked(directoryPath)}
      />
      {pinnedSessions.length > 0 || pinnedActiveSessions.length > 0 ? (
        <div className="flex flex-col pb-1">
          <div className="mt-4 flex h-6 items-center px-2 text-[11px] font-medium text-(--dim)">
            Pinned
          </div>{" "}
          {pinnedActiveSessions.map(({ session, project }) => (
            <ActiveSessionRow
              key={`${session.paneId}:${session.tabId}`}
              project={project}
              session={session}
              pref={activeSessionPref(session, prefs)}
            />
          ))}
          {pinnedSessions
            .filter((session) => !pinnedActiveSessionIds.has(session.id))
            .map((session) => (
              <SessionRow
                key={`${session.project.id}:${session.id}`}
                project={session.project}
                session={session}
                pref={prefs[session.id] ?? {}}
              />
            ))}{" "}
        </div>
      ) : null}{" "}
      {chatProject ? (
        <>
          <SidebarSectionHeader
            label="Chats"
            open={chatsExpanded}
            onToggle={() => setChatsExpanded((value) => !value)}
            action={
              <Link
                href={`/agent?project=${encodeURIComponent(chatProject.id)}&new=1`}
                onClick={(event) => {
                  if (window.location.pathname !== "/agent") return;
                  event.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent(NEW_AGENT_SESSION_EVENT, {
                      detail: { projectId: chatProject.id },
                    }),
                  );
                }}
                className="rounded p-0.5 text-(--dim) transition-colors hover:text-(--fg)"
                title="New chat"
                aria-label="New chat"
              >
                <PlusIcon className="h-3.5 w-3.5" />{" "}
              </Link>
            }
          />
          {chatsExpanded ? (
            <ProjectSessions
              project={chatProject}
              activeSessions={activeSessions}
              prefs={prefs}
              excludedIds={pinnedRenderedIds}
            />
          ) : null}
        </>
      ) : null}
      <SidebarSectionHeader
        label="Projects"
        open={projectsExpanded}
        onToggle={() => setProjectsExpanded((value) => !value)}
        action={
          <button
            type="button"
            onClick={handleAddProject}
            className="rounded p-0.5 text-(--dim) transition-colors hover:text-(--fg)"
            title="Add folder"
            aria-label="Add folder"
          >
            <PlusIcon className="h-3.5 w-3.5" />{" "}
          </button>
        }
      />
      {projectsExpanded ? (
        fileProjects.length === 0 ? (
          <button
            type="button"
            onClick={handleAddProject}
            className="px-2 py-1 text-left text-[12px] text-(--dim) hover:text-(--fg)"
          >
            {" "}
            No projects yet — pick a folder to get started.
          </button>
        ) : (
          fileProjects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              open={openIds.has(project.id)}
              activeSessions={activeSessions.filter((session) => session.projectId === project.id)}
              prefs={prefs}
              excludedIds={pinnedRenderedIds}
              onToggle={() => toggle(project.id)}
              onRemove={() => {
                setAddError("");
                void removeProjectAndCloseRow(project.id).catch((error) => {
                  setAddError(error instanceof Error ? error.message : "Failed to remove project");
                });
              }}
            />
          ))
        )
      ) : null}
      {addError ? <div className="px-2 py-1 text-[11px] text-red-400">{addError}</div> : null}{" "}
    </div>
  );
}
function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="mt-4 flex h-6 items-center justify-between px-2 text-[11px] font-medium text-(--dim)">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--fg)"
        aria-expanded={open}
      >
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span>{label}</span>
      </button>
      {action}
    </div>
  );
}
function ProjectRow({
  project,
  open,
  onToggle,
  onRemove,
  activeSessions,
  prefs,
  excludedIds,
  icon = "folder",
}: {
  project: ProjectEntry;
  open: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  activeSessions: ActiveAgentSession[];
  prefs: SessionPrefs;
  excludedIds: ReadonlySet<string>;
  icon?: "folder" | "chat";
}) {
  const [missingErrorVisible, setMissingErrorVisible] = useState(false);
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
      <div className="group relative flex h-7 items-center rounded-md pl-2 pr-1.5 text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)">
        {" "}
        <button
          type="button"
          onClick={handleToggle}
          title={project.path}
          className="flex min-w-0 flex-1 items-center gap-2 px-0 pr-8 text-left"
        >
          {icon === "chat" ? (
            <ChatIcon className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
          ) : (
            <span className="relative h-3.5 w-3.5 shrink-0 text-(--dim)">
              {" "}
              <Folder
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-90 opacity-0" : "scale-100 opacity-80"}`}
              />
              <FolderOpen
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-100 opacity-80" : "scale-90 opacity-0"}`}
              />{" "}
            </span>
          )}
          <span className="truncate text-[13px] font-medium text-(--fg)">{project.name}</span>{" "}
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
              title={project.path}
              aria-label={`Folder not found at ${project.path}`}
            />
          ) : null}
        </button>{" "}
        <Link
          href={`/agent?project=${encodeURIComponent(project.id)}&new=1`}
          onClick={(event) => {
            if (window.location.pathname !== "/agent") return;
            event.preventDefault();
            window.dispatchEvent(
              new CustomEvent(NEW_AGENT_SESSION_EVENT, { detail: { projectId: project.id } }),
            );
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-(--dim) opacity-0 hover:text-(--fg) group-hover:opacity-100"
          title="New chat"
          aria-label={`New chat in ${project.name}`}
        >
          <PlusIcon className="h-3.5 w-3.5" />{" "}
        </Link>
        {onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 text-(--dim) opacity-0 hover:text-(--err) group-hover:opacity-100"
            title="Remove from list"
            aria-label="Remove project"
          >
            {" "}
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}{" "}
      </div>
      {missingErrorVisible && !project.exists ? (
        <div className="pl-12 pr-2 pb-1 text-[12px] text-red-400">
          <span>Folder not found at {project.path}</span>{" "}
          <button
            type="button"
            onClick={onRemove}
            disabled={!onRemove}
            className="ml-2 text-(--dim) underline underline-offset-2 hover:text-(--fg)"
          >
            Remove{" "}
          </button>
        </div>
      ) : null}
      {open && project.exists ? (
        <ProjectSessions
          project={project}
          activeSessions={activeSessions}
          prefs={prefs}
          excludedIds={excludedIds}
        />
      ) : null}{" "}
    </div>
  );
}
function ProjectSessions({
  project,
  activeSessions,
  prefs,
  excludedIds,
}: {
  project: ProjectEntry;
  activeSessions: ActiveAgentSession[];
  prefs: SessionPrefs;
  /** Session ids already rendered elsewhere in the sidebar (e.g. Pinned). */ excludedIds: ReadonlySet<string>;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const projectActiveSessions = useMemo(
    () => activeSessions.filter((session) => session.projectId === project.id),
    [activeSessions, project.id],
  );
  const activePiSessionIds = useMemo(
    () =>
      new Set(
        projectActiveSessions
          .map((session) => session.piSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [projectActiveSessions],
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
      const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [project.path]);
  useEffect(() => {
    void reload();
    window.addEventListener(SESSIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, reload);
  }, [reload]);
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
  const visibleActiveSessions = useMemo(
    () =>
      projectActiveSessions.filter((session) => {
        const pref = activeSessionPref(session, prefs);
        if (pref?.pinned) return false;
        if (session.piSessionId && excludedIds.has(session.piSessionId)) return false;
        return showHidden || !pref?.hidden;
      }),
    [projectActiveSessions, prefs, excludedIds, showHidden],
  );
  const { recent, hidden, allRecent } = useMemo(() => {
    const seen = new Set<string>();
    const recent: SessionSummary[] = [];
    const hidden: SessionSummary[] = [];
    const allRecent: SessionSummary[] = [];
    for (const session of sessions ?? []) {
      if (activePiSessionIds.has(session.id)) continue;
      if (excludedIds.has(session.id)) continue;
      if (prefs[session.id]?.pinned) continue;
      const key = sessionDedupeKey(session);
      if (seen.has(session.id) || seen.has(key)) continue;
      seen.add(session.id);
      seen.add(key);
      allRecent.push(session);
      if (prefs[session.id]?.hidden) hidden.push(session);
      else recent.push(session);
    }
    return { recent, hidden, allRecent };
  }, [sessions, activePiSessionIds, excludedIds, prefs]);
  return (
    <div className="flex flex-col">
      {" "}
      {visibleActiveSessions.map((session) => (
        <ActiveSessionRow
          key={`${session.paneId}:${session.tabId}`}
          project={project}
          session={session}
          pref={activeSessionPref(session, prefs)}
        />
      ))}
      {loading && !sessions ? (
        <div className="pl-10 pr-4 py-1 text-[12px] text-(--dim)">Loading…</div>
      ) : allRecent.length === 0 && visibleActiveSessions.length === 0 ? (
        <div className="pl-10 pr-4 py-1 text-[12px] text-(--dim)">No chats</div>
      ) : (
        <>
          {" "}
          {recent.map((session) => (
            <SessionRow
              key={session.id}
              project={project}
              session={session}
              pref={prefs[session.id] ?? {}}
            />
          ))}
          {hidden.length > 0 ? (
            <button
              type="button"
              onClick={toggleShowHidden}
              className="flex h-6 items-center gap-1 pl-10 pr-4 text-[12px] text-(--dim) hover:text-(--fg)"
              title={showHidden ? "Hide hidden sessions" : "Show hidden sessions"}
            >
              <EyeOffIcon className="w-3 h-3 shrink-0" />{" "}
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
                />
              ))
            : null}{" "}
        </>
      )}{" "}
    </div>
  );
}
type SessionNavRowProps = {
  pref: SessionPref;
  label: string;
  initialDraft: string;
  age: string;
  rowClass: string;
  renameRowClass?: string;
  href?: string;
  onOpen?: () => void;
  onPatchPref: (patch: SessionPref) => void;
  onRenameCommit?: (title: string) => void;
  onRememberTitle?: () => void;
  onDragStart: (event: DragEvent) => void;
  onContextMenu?: boolean;
  isRunning?: boolean;
  canDoubleClickRename?: boolean;
  showClearAction?: boolean;
  menuIconClass?: string;
  renameInputClass?: string;
  menuItemsWithIcons?: boolean;
};
function SessionNavRow({
  pref,
  label,
  initialDraft,
  age,
  rowClass,
  renameRowClass = rowClass,
  href,
  onOpen,
  onPatchPref,
  onRenameCommit,
  onRememberTitle,
  onDragStart,
  onContextMenu = false,
  isRunning = false,
  canDoubleClickRename = false,
  showClearAction = false,
  menuIconClass = "h-3 w-3",
  renameInputClass = "text-[12px]",
  menuItemsWithIcons = false,
}: SessionNavRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));
  const startRename = () => {
    setDraft(initialDraft);
    setRenaming(true);
  };
  const finishRename = () => {
    const trimmed = draft.trim();
    onPatchPref({ title: trimmed || undefined });
    onRenameCommit?.(trimmed);
    setRenaming(false);
  };
  if (renaming) {
    return (
      <div className={renameRowClass}>
        {" "}
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(initialDraft);
              setRenaming(false);
            }
          }}
          className={`min-w-0 flex-1 bg-transparent ${renameInputClass} text-(--fg) outline-none`}
        />{" "}
      </div>
    );
  }
  const content = (
    <>
      {" "}
      <span className="min-w-0 flex-1 truncate text-[11px] font-normal leading-6">{label}</span>
      {age ? (
        <span className="shrink-0 pl-2 pr-1 font-mono text-[9px] text-(--dim)">{age}</span>
      ) : null}{" "}
    </>
  );
  const openProps = canDoubleClickRename
    ? {
        onDoubleClick: (event: ReactMouseEvent) => {
          event.preventDefault();
          startRename();
        },
      }
    : {};
  return (
    <div
      className={rowClass}
      onContextMenu={
        onContextMenu
          ? (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
          : undefined
      }
    >
      <SessionPinButton
        pinned={Boolean(pref.pinned)}
        running={isRunning}
        onToggle={() => onPatchPref({ pinned: !pref.pinned })}
      />{" "}
      {href ? (
        <Link
          href={href}
          title={label}
          draggable
          onClick={onRememberTitle}
          onDragStart={onDragStart}
          className="flex min-w-0 flex-1 items-center gap-1 pr-5"
          {...openProps}
        >
          {" "}
          {content}
        </Link>
      ) : (
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1 pr-5 text-left"
          {...openProps}
        >
          {" "}
          {content}
        </button>
      )}
      <div ref={menuRef} className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0">
        {" "}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className="p-0.5 text-(--dim) opacity-0 hover:text-(--fg) group-hover:opacity-100"
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className={menuIconClass} />{" "}
        </button>
        {menuOpen ? (
          <div className={SESSION_MENU_CLASS}>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                startRename();
              }}
            >
              Rename{" "}
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                onPatchPref({ pinned: !pref.pinned });
              }}
            >
              {menuItemsWithIcons ? (
                <span className="inline-flex items-center gap-2">
                  <PinIcon className="h-4 w-4" /> {pref.pinned ? "Unpin" : "Pin"}{" "}
                </span>
              ) : pref.pinned ? (
                "Unpin"
              ) : (
                "Pin"
              )}{" "}
            </SessionMenuItem>
            <SessionMenuItem
              onClick={() => {
                setMenuOpen(false);
                onPatchPref({ hidden: !pref.hidden });
              }}
            >
              {menuItemsWithIcons ? (
                <span className="inline-flex items-center gap-2">
                  <EyeOffIcon className="h-4 w-4" /> {pref.hidden ? "Unarchive" : "Archive"}{" "}
                </span>
              ) : pref.hidden ? (
                "Unarchive"
              ) : (
                "Archive"
              )}{" "}
            </SessionMenuItem>
            {showClearAction && (pref.title || pref.pinned || pref.hidden) ? (
              <SessionMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onPatchPref({ title: undefined, pinned: undefined, hidden: undefined });
                }}
              >
                {" "}
                <span className="inline-flex items-center gap-2 text-(--err)">
                  <CloseIcon className="h-4 w-4" /> Clear{" "}
                </span>
              </SessionMenuItem>
            ) : null}
          </div>
        ) : null}
      </div>{" "}
    </div>
  );
}
function ActiveSessionRow({
  project,
  session,
  pref,
}: {
  project: ProjectEntry;
  session: ActiveAgentSession;
  pref: SessionPref;
}) {
  const label = pref.title || session.title || "Current session";
  const isActive = session.active === true;
  const rowClass = `group relative flex h-6 items-center gap-1 pl-4 pr-2 transition-colors ${isActive ? "text-(--fg) before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-full before:bg-(--accent) before:content-['']" : "text-(--dim) hover:text-(--fg)"}`;
  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={pref.title ?? session.title ?? ""}
      age={relativeAge(session.startedAt ?? session.updatedAt)}
      rowClass={rowClass}
      href={
        session.piSessionId
          ? `/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.piSessionId)}`
          : undefined
      }
      onOpen={() => {
        window.dispatchEvent(
          new CustomEvent(ACTIVE_AGENT_SESSION_OPEN_EVENT, {
            detail: { paneId: session.paneId, tabId: session.tabId, mode: "focus" },
          }),
        );
      }}
      onPatchPref={(patch) => patchActiveSessionPref(session, patch)}
      onRenameCommit={(trimmed) => {
        window.dispatchEvent(
          new CustomEvent(ACTIVE_AGENT_SESSION_RENAME_EVENT, {
            detail: {
              paneId: session.paneId,
              tabId: session.tabId,
              title: trimmed || session.title,
            },
          }),
        );
      }}
      onRememberTitle={() => rememberAgentSessionNavTitle(session.piSessionId, label)}
      onDragStart={(event) => setAgentSessionDragData(event, session)}
      isRunning={session.status !== "idle" && session.status !== "done"}
      canDoubleClickRename
      menuIconClass="h-3.5 w-3.5"
      renameInputClass="text-[12px]"
    />
  );
}
function SessionRow({
  project,
  session,
  pref,
}: {
  project: ProjectEntry;
  session: SessionSummary;
  pref: SessionPref;
}) {
  const label = pref.title || session.firstUserMessage || "Untitled session";
  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={pref.title ?? session.firstUserMessage ?? ""}
      age={relativeAge(session.startedAt)}
      rowClass="group relative flex h-6 items-center gap-1 pl-4 pr-2 text-(--dim) transition-colors hover:text-(--fg)"
      renameRowClass="flex h-6 items-center gap-1 bg-(--surface)/60 pl-4 pr-2"
      href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}`}
      onPatchPref={(patch) => patchSessionPref(session.id, patch)}
      onRememberTitle={() => rememberAgentSessionNavTitle(session.id, label)}
      onDragStart={(event) => {
        setAgentSessionDragData(event, {
          piSessionId: session.id,
          projectId: project.id,
          cwd: project.path,
          title: label,
        });
      }}
      onContextMenu
      showClearAction
      menuItemsWithIcons
    />
  );
}
function SessionPinButton({
  pinned,
  onToggle,
  disabled = false,
  running = false,
}: {
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
  running?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onToggle();
      }}
      disabled={disabled}
      className={`inline-flex h-6 w-4 shrink-0 items-center justify-center transition-opacity hover:text-(--fg) disabled:opacity-20 ${pinned ? "text-(--accent) opacity-100" : "text-(--dim) opacity-60 group-hover:opacity-100"}`}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin session" : "Pin session"}
      title={pinned ? "Unpin session" : "Pin session"}
    >
      <PinIcon className={`h-3.5 w-3.5 ${running ? "animate-pulse" : ""}`} />{" "}
    </button>
  );
}
function SessionMenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-sm px-2 py-1 text-left text-xs text-(--fg) hover:bg-[#242424]"
    >
      {children}{" "}
    </button>
  );
}
