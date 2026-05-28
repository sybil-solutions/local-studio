// Window-event names used as a workspace-internal bus between the sidebar /
// project nav and the workspace state. Keep in one place so all senders and
// receivers reference the same string.

export const SESSIONS_CHANGED_EVENT = "vllm-studio.agent.sessionsChanged";
export const PROJECTS_CHANGED_EVENT = "vllm-studio.agent.projectsChanged";
export const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";
export const NEW_AGENT_SESSION_EVENT = "vllm-studio.agent.newSession";
export const ACTIVE_AGENT_SESSION_RENAME_EVENT = "vllm-studio.agent.activeSessionRename";
export const ACTIVE_AGENT_SESSION_OPEN_EVENT = "vllm-studio.agent.activeSessionOpen";
export const ADD_PROJECT_EVENT = "vllm-studio.agent.addProject";
export const SESSION_PREFS_CHANGED_EVENT = "vllm-studio.agent.sessionPrefs.changed";

/**
 * Fired once by `ProjectsProvider` when its first project load completes (or
 * fails). The workspace listens for this to hydrate persisted active-session
 * snapshots — we wait until we know which projects are still installed so we
 * can filter out snapshots whose project is gone. Carries the loaded list in
 * `detail.projects` so subscribers don't need their own projects-context dep.
 */
export const PROJECTS_LOADED_EVENT = "vllm-studio.agent.projectsLoaded";
