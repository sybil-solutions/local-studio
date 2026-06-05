import { useCallback, useState, useSyncExternalStore } from "react";
import {
  SettingsButton,
  SettingsFactRows,
  SettingsGroup,
  StatusPill,
  type SettingsFactRow,
} from "@/ui";
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
  const archiveRows: SettingsFactRow[] = error
    ? [
        {
          key: "archive-error",
          label: "Archive",
          description: error,
          value: "Try refreshing this settings section.",
          dim: true,
          status: { label: "error", tone: "warning" },
        },
      ]
    : sessions.length === 0
      ? [
          {
            key: "archive-empty",
            label: "Archive",
            description: "Use a session row menu to archive instead of deleting from disk.",
            value: loading ? "Loading archived chats…" : "No archived chats.",
            dim: true,
            status: { label: loading ? "loading" : "empty" },
          },
        ]
      : sessions.map((session) => ({
          key: session.id,
          label: cleanSessionTitle(session.firstUserMessage) || session.id,
          description: session.projectPath || "Session project metadata is not available.",
          value: session.id,
          mono: true,
          status: { label: "archived", tone: "info" },
          actions: (
            <SettingsButton
              onClick={() => void unarchive(session)}
              disabled={restoringId === session.id}
            >
              {restoringId === session.id ? "Restoring" : "Restore"}
            </SettingsButton>
          ),
          children: (
            <div className="text-[length:var(--fs-md)] text-(--dim)/55">
              {session.projectName ? `${session.projectName} · ` : ""}
              {session.archivedAt ? `archived ${session.archivedAt}` : session.updatedAt}
            </div>
          ),
        }));
  return (
    <SettingsGroup
      title="Archived chats"
      description="Archived sessions are excluded from normal chat fetches. Restore one here to return it to the sidebar."
      actions={<StatusPill>{loading ? "loading" : `${sessions.length} archived`}</StatusPill>}
    >
      <SettingsFactRows rows={archiveRows} />
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
  const skillRows: SettingsFactRow[] =
    skills.length === 0
      ? [
          {
            key: "skill-discovery-empty",
            label: "Skill discovery",
            description: "No SKILL.md entries were found in the configured roots.",
            value: "Empty discovery result",
            dim: true,
            status: { label: "empty", tone: "warning" },
          },
        ]
      : skills.slice(0, 80).map((skill) => ({
          key: skill.id,
          label: skill.name,
          description: "Available in the composer with $.",
          value: `${skill.source} · ${skill.path}`,
          mono: true,
          truncate: true,
          status: { label: "discovered", tone: "info" },
        }));
  return (
    <SettingsGroup
      title="Skills"
      description="Normalized, deduplicated skills discovered from ~/.claude, ~/.pi, ~/.codex, ~/.factory, and ~/.opencode."
      actions={
        <StatusPill tone={skills.length ? "good" : "warning"}>{skills.length} skills</StatusPill>
      }
    >
      <SettingsFactRows rows={skillRows} />
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
  const setupRows: SettingsFactRow[] = rows.map((check) => ({
    key: check.id,
    label: check.label,
    description: check.guidance,
    value: check.value,
    mono: true,
    status: { label: check.ok ? "ok" : "missing", tone: check.ok ? "good" : "warning" },
  }));
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
      <SettingsFactRows rows={setupRows} />
    </SettingsGroup>
  );
}
