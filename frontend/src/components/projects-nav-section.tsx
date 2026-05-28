"use client";
import Link from "next/link";
import {
  useCallback,
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
import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import {
  useActiveAgentSessionsEffect,
  usePinnedSessionsEffect,
  useProjectDirectoryPickerModalEffects,
  useProjectSessionsReloadEffect,
  useProjectsNavAddProjectEffect,
  useProjectsNavSessionPrefs,
} from "@/hooks/agent/use-projects-nav-section-effects";
import {
  ACTIVE_AGENT_SESSION_OPEN_EVENT,
  ACTIVE_AGENT_SESSION_RENAME_EVENT,
  ADD_PROJECT_EVENT,
  NEW_AGENT_SESSION_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/agent/workspace/events";
import { loadPersistedActiveAgentSessions } from "@/lib/agent/workspace/store";
import { useProjects } from "@/lib/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/lib/agent/projects/api";
import { useClickOutside } from "@/hooks/use-click-outside";
import { patchSessionPref, type SessionPref, type SessionPrefs } from "@/lib/agent/session/prefs";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
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
  archived: boolean;
  archivedAt: string | null;
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
const SESSION_NAV_TITLE_PREFIX = "vllm-studio.agent.sessionNavTitle:";
const SESSION_MENU_CLASS =
  "absolute right-0 top-5 isolate z-[999] min-w-[150px] rounded-md border border-[#3a3a3a] bg-[#202020] p-1 text-xs text-(--fg) opacity-100 shadow-[0_12px_32px_rgba(0,0,0,0.85)]";
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
function activeSessionPrefKeys(
  session: Pick<ActiveAgentSession, "piSessionId" | "paneId" | "tabId">,
): string[] {
  return [
    session.piSessionId,
    session.paneId && session.tabId ? `tab:${session.paneId}:${session.tabId}` : null,
  ].filter((value): value is string => Boolean(value));
}
export function mergeActiveSessionPref(
  session: Pick<ActiveAgentSession, "piSessionId" | "paneId" | "tabId">,
  prefs: SessionPrefs,
): SessionPref {
  const merged: SessionPref = {};
  for (const key of activeSessionPrefKeys(session)) {
    const pref = prefs[key];
    if (!pref) continue;
    if (pref.title) merged.title = pref.title;
    if (pref.pinned) merged.pinned = true;
    if (pref.hidden) merged.hidden = true;
  }
  return merged;
}

function activeSessionPref(session: ActiveAgentSession, prefs: SessionPrefs): SessionPref {
  return mergeActiveSessionPref(session, prefs);
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
const useSessionPrefs = useProjectsNavSessionPrefs;
export function triggerAddProjectFlow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
}
export function rememberAgentSessionNavTitle(sessionId: string | null | undefined, title: string) {
  if (typeof window === "undefined" || !sessionId) return;
  const trimmed = cleanSessionTitle(title);
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
    const title = cleanSessionTitle(window.sessionStorage.getItem(key)) || undefined;
    window.sessionStorage.removeItem(key);
    return title;
  } catch {
    return undefined;
  }
}
async function setSessionArchive(
  sessionId: string,
  project: ProjectEntry,
  title: string,
  archived: boolean,
): Promise<void> {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: project.path,
      archived,
      projectId: project.id,
      projectName: project.name,
      title,
    }),
  });
  const payload = await safeJson<{ error?: string }>(response);
  if (!response.ok) {
    throw new Error(payload.error || "Failed to update session archive");
  }
  window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
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
  useProjectDirectoryPickerModalEffects({ loadDirectory, open });
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
export function ProjectsNavSection({ expanded }: { expanded: boolean }) {
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
  // Chats collapses by default — its row count grows fast and most navigation
  // happens via the Pinned strip above it.
  const [chatsExpanded, setChatsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  useProjectsNavAddProjectEffect(handleAddProject);
  useActiveAgentSessionsEffect({ setActiveSessions });
  usePinnedSessionsEffect({
    activePiSessionIdsKey,
    expanded,
    hiddenPrefIdsKey,
    pinnedPrefIdsKey,
    projects,
    setPinnedSessions,
  });
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
        <div className="flex flex-col">
          <div className="mt-3 flex h-5 items-center px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--dim)">
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
              <NewChatPlusButton
                projectId={chatProject.id}
                label="New chat"
                className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
              />
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
            className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
            title="Add folder"
            aria-label="Add folder"
          >
            <PlusIcon className="block h-3.5 w-3.5" />
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
    <div className="group mt-3 flex h-5 items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--dim)">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--fg) focus-visible:text-(--fg) focus-visible:outline-none"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {action ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </div>
      ) : null}
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
      <div className="group relative flex h-7 items-center rounded-md pl-2 pr-1.5 text-(--dim)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)/80">
        {" "}
        <button
          type="button"
          onClick={handleToggle}
          title={project.path}
          className="flex min-w-0 flex-1 items-center gap-2 px-0 pr-8 text-left"
        >
          {icon === "chat" ? (
            <ChatIcon className="h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-75" />
          ) : (
            <span className="relative h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-75">
              {" "}
              <Folder
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}
              />
              <FolderOpen
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
              />{" "}
            </span>
          )}
          <span className="truncate text-[13px] font-normal text-(--dim) transition-colors group-hover:text-(--fg)/85">
            {project.name}
          </span>{" "}
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
              title={project.path}
              aria-label={`Folder not found at ${project.path}`}
            />
          ) : null}
        </button>{" "}
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <NewChatPlusButton
            projectId={project.id}
            label={`New chat in ${project.name}`}
            className="flex h-5 w-5 items-center justify-center text-(--dim)/55 hover:text-(--fg)/80"
          />
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
            className="absolute right-6 top-1/2 -translate-y-1/2 p-0.5 text-(--dim)/55 opacity-0 hover:text-(--err) group-hover:opacity-100"
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
  excludedIds: ReadonlySet<string>;
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
  useProjectSessionsReloadEffect(reload);
  const visibleActiveSessions = useMemo(
    () =>
      projectActiveSessions.filter((session) => {
        const pref = activeSessionPref(session, prefs);
        if (pref?.pinned) return false;
        if (session.piSessionId && excludedIds.has(session.piSessionId)) return false;
        return !pref?.hidden;
      }),
    [projectActiveSessions, prefs, excludedIds],
  );
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const recent: SessionSummary[] = [];
    for (const session of sessions ?? []) {
      if (activePiSessionIds.has(session.id)) continue;
      if (excludedIds.has(session.id)) continue;
      if (prefs[session.id]?.pinned) continue;
      if (prefs[session.id]?.hidden) continue;
      const key = sessionDedupeKey(session);
      if (seen.has(session.id) || seen.has(key)) continue;
      seen.add(session.id);
      seen.add(key);
      recent.push(session);
    }
    return recent;
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
        <div className="pl-2 pr-2 py-0.5 text-[11px] text-(--dim)">Loading…</div>
      ) : recent.length === 0 && visibleActiveSessions.length === 0 ? (
        <div className="pl-2 pr-2 py-0.5 text-[11px] text-(--dim)">No chats</div>
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
  onArchive?: () => void;
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
  onArchive,
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
      <span className="min-w-0 flex-1 truncate text-[10.5px] font-normal leading-4 text-(--fg)/78 transition-colors group-hover:text-(--fg)/95">
        {label}
      </span>
      {age ? (
        <span className="shrink-0 pl-1.5 pr-1 font-mono text-[8.5px] text-(--dim)">{age}</span>
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
      className={`${rowClass} ${menuOpen ? "z-[900]" : "z-0"}`}
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
          aria-label={label}
          draggable
          onClick={onRememberTitle}
          onDragStart={onDragStart}
          className="flex min-w-0 flex-1 items-center gap-1"
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
          aria-label={label}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          {...openProps}
        >
          {" "}
          {content}
        </button>
      )}
      <div ref={menuRef} className="absolute right-1 top-1/2 z-20 -translate-y-1/2 shrink-0">
        {" "}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-(--hover)/95 text-(--dim) shadow-[0_0_14px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-[opacity,color] hover:text-(--fg) ${
            menuOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          }`}
          aria-label="Session options"
          title="Session options"
        >
          <MoreIcon className={`pointer-events-none ${menuIconClass}`} />{" "}
        </button>
        {menuOpen ? (
          <div className={SESSION_MENU_CLASS} role="menu">
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
            {onArchive ? (
              <SessionMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onArchive();
                }}
              >
                {menuItemsWithIcons ? (
                  <span className="inline-flex items-center gap-2">
                    <EyeOffIcon className="h-4 w-4" /> Archive{" "}
                  </span>
                ) : (
                  "Archive"
                )}{" "}
              </SessionMenuItem>
            ) : null}
            {showClearAction && (pref.title || pref.pinned) ? (
              <SessionMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  onPatchPref({ title: undefined, pinned: undefined });
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
  const label =
    cleanSessionTitle(pref.title) || cleanSessionTitle(session.title) || "Current session";
  const isActive = session.active === true;
  const rowClass = `group relative flex h-6 items-center rounded-md pl-3 pr-0 transition-colors ${isActive ? "bg-(--hover) text-(--fg)" : "text-(--fg)/72 hover:bg-(--hover) hover:text-(--fg)/95"}`;
  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={cleanSessionTitle(pref.title) || cleanSessionTitle(session.title)}
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
              title: cleanSessionTitle(trimmed) || cleanSessionTitle(session.title) || label,
            },
          }),
        );
      }}
      onRememberTitle={() => rememberAgentSessionNavTitle(session.piSessionId, label)}
      onDragStart={(event) => setAgentSessionDragData(event, session)}
      isRunning={session.status !== "idle" && session.status !== "done"}
      canDoubleClickRename
      menuIconClass="h-3.5 w-3.5"
      renameInputClass="text-[10.5px]"
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
  const label =
    cleanSessionTitle(pref.title) ||
    cleanSessionTitle(session.firstUserMessage) ||
    "Untitled session";
  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={cleanSessionTitle(pref.title) || cleanSessionTitle(session.firstUserMessage)}
      age={relativeAge(session.startedAt)}
      rowClass="group relative flex h-6 items-center rounded-md pl-3 pr-0 text-(--fg)/72 transition-colors hover:bg-(--hover) hover:text-(--fg)/95"
      renameRowClass="flex h-6 items-center rounded-md bg-(--surface)/40 pl-3 pr-1"
      href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}`}
      onPatchPref={(patch) => patchSessionPref(session.id, patch)}
      onArchive={() => {
        void setSessionArchive(session.id, project, label, true)
          .then(() => patchSessionPref(session.id, { hidden: undefined }))
          .catch((error) => {
            console.warn("[agent] failed to archive session", error);
          });
      }}
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
      className={`pointer-events-none absolute left-1.5 top-1/2 z-20 inline-flex h-5 w-5 shrink-0 -translate-y-1/2 scale-90 items-center justify-center rounded-md bg-(--hover)/95 opacity-0 shadow-[0_0_14px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-[opacity,transform,color] duration-300 ease-out hover:text-(--fg) group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100 disabled:opacity-20 ${pinned ? "text-(--accent)" : "text-(--fg)/78"}`}
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

function NewChatPlusButton({
  projectId,
  label,
  className,
}: {
  projectId: string;
  label: string;
  className: string;
}) {
  return (
    <div className="relative flex items-center justify-center leading-none">
      <Link
        href={`/agent?project=${encodeURIComponent(projectId)}&new=1`}
        onClick={(event) => {
          if (window.location.pathname !== "/agent") return;
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent(NEW_AGENT_SESSION_EVENT, { detail: { projectId } }));
        }}
        className={className}
        aria-label={label}
        title={label}
      >
        <PlusIcon className="block h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
