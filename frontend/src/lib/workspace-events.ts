// Window-event names used as a workspace-internal bus between the sidebar /
// project nav and the workspace state. Keep in one place so all senders and
// receivers reference the same string.

export const SESSIONS_CHANGED_EVENT = "local-studio.agent.sessionsChanged";
export const ACTIVE_AGENT_SESSIONS_EVENT = "local-studio.agent.activeSessions";
export const ADD_PROJECT_EVENT = "local-studio.agent.addProject";
export const SESSION_PREFS_CHANGED_EVENT = "local-studio.agent.sessionPrefs.changed";

/**
 * Fired when the global "show model reasoning" preference toggles. The timeline
 * subscribes (via `useReasoningVisible`) so every open pane re-renders to show
 * or hide the "Thinking"/"Thought" disclosures immediately.
 */
export const REASONING_VISIBILITY_CHANGED_EVENT = "local-studio.agent.reasoningVisibility.changed";

/**
 * Fired once by `ProjectsProvider` when its first project load completes (or
 * fails). The workspace listens for this to hydrate persisted active-session
 * snapshots — we wait until we know which projects are still installed so we
 * can filter out snapshots whose project is gone. Carries the loaded list in
 * `detail.projects` so subscribers don't need their own projects-context dep.
 */
export const PROJECTS_LOADED_EVENT = "local-studio.agent.projectsLoaded";
