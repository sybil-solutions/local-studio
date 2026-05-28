import { useCallback, useState, useSyncExternalStore } from "react";
import { SettingsButton, SettingsGroup, SettingsRow, SettingsValue, StatusPill } from "@/ui";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
import { SESSIONS_CHANGED_EVENT } from "@/lib/agent/workspace/events";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import { getConfigsViewSnapshot } from "./configs-view-snapshot";

export function ArchivedChatsSettings() {
  type Session = {
    id: string;
    projectName?: string;
    projectPath?: string;
    firstUserMessage?: string | null;
    updatedAt?: string;
    archived?: boolean;
    archivedAt?: string | null;
  };
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const loadArchivedSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agent/sessions/all?archived=1", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { sessions?: Session[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to load archived chats");
      setSessions(payload.sessions ?? []);
    } catch (loadError) {
      setSessions([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load archived chats");
    } finally {
      setLoading(false);
    }
  }, []);
  const subscribeArchivedSessions = useCallback(
    (_notify: () => void) => {
      void loadArchivedSessions();
      window.addEventListener(SESSIONS_CHANGED_EVENT, loadArchivedSessions);
      return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, loadArchivedSessions);
    },
    [loadArchivedSessions],
  );

  useSyncExternalStore(subscribeArchivedSessions, getConfigsViewSnapshot, getConfigsViewSnapshot);
  const unarchive = async (session: Session) => {
    setRestoringId(session.id);
    setError("");
    try {
      const response = await fetch(`/api/agent/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archived: false,
          ...(session.projectPath ? { cwd: session.projectPath } : {}),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to restore chat");
      setSessions((current) => current.filter((row) => row.id !== session.id));
      window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Failed to restore chat");
    } finally {
      setRestoringId(null);
    }
  };
  return (
    <SettingsGroup
      title="Archived chats"
      description="Archived sessions are excluded from normal chat fetches. Restore one here to return it to the sidebar."
      actions={<StatusPill>{loading ? "loading" : `${sessions.length} archived`}</StatusPill>}
    >
      {error ? (
        <SettingsRow
          label="Archive"
          description={error}
          value={<SettingsValue dim>Try refreshing this settings section.</SettingsValue>}
          status={<StatusPill tone="warning">error</StatusPill>}
        />
      ) : null}
      {!error && sessions.length === 0 ? (
        <SettingsRow
          label="Archive"
          description="Use a session row menu to archive instead of deleting from disk."
          value={
            <SettingsValue dim>
              {loading ? "Loading archived chats…" : "No archived chats."}
            </SettingsValue>
          }
          status={<StatusPill>{loading ? "loading" : "empty"}</StatusPill>}
        />
      ) : (
        sessions.map((session) => {
          return (
            <SettingsRow
              key={session.id}
              label={cleanSessionTitle(session.firstUserMessage) || session.id}
              description={session.projectPath || "Session project metadata is not available."}
              value={<SettingsValue mono>{session.id}</SettingsValue>}
              status={<StatusPill tone="info">archived</StatusPill>}
              actions={
                <SettingsButton
                  onClick={() => void unarchive(session)}
                  disabled={restoringId === session.id}
                >
                  {restoringId === session.id ? "Restoring" : "Restore"}
                </SettingsButton>
              }
            >
              <div className="text-[12px] text-(--dim)/55">
                {" "}
                {session.projectName ? `${session.projectName} · ` : ""}
                {session.archivedAt ? `archived ${session.archivedAt}` : session.updatedAt}{" "}
              </div>
            </SettingsRow>
          );
        })
      )}
    </SettingsGroup>
  );
}
export function SkillsSettings() {
  type Skill = { id: string; name: string; source: string; path: string };
  const [skills, setSkills] = useState<Skill[]>([]);
  const subscribeSkills = useCallback((_notify: () => void) => {
    void fetch("/api/agent/skills", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ skills?: Skill[] }>)
      .then((payload) => setSkills(payload.skills ?? []))
      .catch(() => setSkills([]));
    return () => {};
  }, []);

  useSyncExternalStore(subscribeSkills, getConfigsViewSnapshot, getConfigsViewSnapshot);
  return (
    <SettingsGroup
      title="Skills"
      description="Normalized, deduplicated skills discovered from ~/.claude, ~/.pi, ~/.codex, ~/.factory, and ~/.opencode."
      actions={
        <StatusPill tone={skills.length ? "good" : "warning"}>{skills.length} skills</StatusPill>
      }
    >
      {skills.length === 0 ? (
        <SettingsRow
          label="Skill discovery"
          description="No SKILL.md entries were found in the configured roots."
          value={<SettingsValue dim>Empty discovery result</SettingsValue>}
          status={<StatusPill tone="warning">empty</StatusPill>}
        />
      ) : (
        skills
          .slice(0, 80)
          .map((skill) => (
            <SettingsRow
              key={skill.id}
              label={skill.name}
              description="Available in the composer with $."
              value={<SettingsValue mono>{`${skill.source} · ${skill.path}`}</SettingsValue>}
              status={<StatusPill tone="info">discovered</StatusPill>}
            />
          ))
      )}{" "}
    </SettingsGroup>
  );
}
export function SetupChecksSettings() {
  type Check = { id: string; label: string; ok: boolean; value: string; guidance: string };
  const [checks, setChecks] = useState<Check[]>([]);
  const controllerStatus = useSidebarStatus();
  const subscribeSetupChecks = useCallback((_notify: () => void) => {
    void fetch("/api/agent/setup-checks", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ checks?: Check[] }>)
      .then((payload) => setChecks(payload.checks ?? []))
      .catch(() => setChecks([]));
    return () => {};
  }, []);

  useSyncExternalStore(subscribeSetupChecks, getConfigsViewSnapshot, getConfigsViewSnapshot);
  const controllerCheck: Check = {
    id: "controller",
    label: "Controller connection",
    ok: controllerStatus.online,
    value: controllerStatus.online ? controllerStatus.activityLine : "offline",
    guidance: "Set a reachable controller URL in Settings → Connection before using Agents.",
  };
  const rows = [...checks, controllerCheck];
  const blockers = rows.filter((check) => !check.ok);
  return (
    <SettingsGroup
      title="First-time setup"
      description="Preflight checks prevent new users from landing in an empty Agent tab without explanation."
      actions={
        <StatusPill tone={blockers.length ? "warning" : "good"}>
          {blockers.length ? `${blockers.length} blockers` : "ready"}
        </StatusPill>
      }
    >
      {rows.map((check) => (
        <SettingsRow
          key={check.id}
          label={check.label}
          description={check.guidance}
          value={<SettingsValue mono>{check.value}</SettingsValue>}
          status={
            <StatusPill tone={check.ok ? "good" : "warning"}>
              {check.ok ? "ok" : "missing"}
            </StatusPill>
          }
        />
      ))}{" "}
    </SettingsGroup>
  );
}
