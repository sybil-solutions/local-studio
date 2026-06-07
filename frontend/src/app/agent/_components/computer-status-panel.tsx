"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Code2, Loader2 } from "lucide-react";
import { formatTokenCount } from "@/lib/agent/session";
import { useTools } from "@/lib/agent/tools/context";
import type { ComposerSkillRef } from "@/lib/agent/composer-context";
import type { Project } from "@/lib/agent/projects/types";
import type { Session } from "@/lib/agent/sessions/types";
import type { AgentModel } from "@/lib/agent/workspace/types";

type GitSummary = {
  isRepo: boolean;
  branch?: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
} | null;

type StatusTotals = {
  read: number;
  write: number;
  current: number;
  messages: number;
  queued: number;
  running: number;
};

type StatusRowData = { label: string; value: string };

export function ComputerStatusPanel({
  activeProject,
  activeModel,
  focusedSession,
  sessions,
  gitSummary,
  onCompactSession,
}: {
  activeProject: Project | null;
  activeModel: AgentModel | null;
  focusedSession: Session | null;
  sessions: Session[];
  gitSummary?: GitSummary;
  onCompactSession?: () => Promise<void>;
}) {
  const tools = useTools();
  const [compacting, setCompacting] = useState(false);
  const totals = useMemo(() => summarizeSessions(sessions), [sessions]);
  const sessionSkills = useMemo(() => usedSkillsForSession(focusedSession), [focusedSession]);
  const compactDisabled = isCompactDisabled(
    activeModel,
    focusedSession,
    compacting,
    Boolean(onCompactSession),
  );
  const compactHighlighted = shouldCompactSession(focusedSession);
  const compactFocusedSession = async () => {
    if (compactDisabled) return;
    setCompacting(true);
    try {
      await onCompactSession?.();
    } finally {
      setCompacting(false);
    }
  };
  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-(--dim)">
      <SessionSummary
        title={sessionTitle(focusedSession)}
        sessionTokens={sessionTokenCount(focusedSession)}
        allTokens={totals.current}
        messageCount={totals.messages}
      />

      <StatusSection title="Session">
        <StatusRows rows={sessionTopRows(activeModel, focusedSession)} />
        <StatusActionRow label="Compact">
          <button
            type="button"
            onClick={() => void compactFocusedSession()}
            disabled={compactDisabled}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[length:var(--fs-sm)] ${
              compactHighlighted
                ? "text-(--accent) ring-1 ring-(--accent)/40"
                : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            } disabled:pointer-events-none disabled:opacity-30`}
            title={compactTitle(compactHighlighted)}
          >
            {compacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {compacting ? "Compacting" : "Compact"}
          </button>
        </StatusActionRow>
        <StatusRows rows={sessionBottomRows(totals)} />
      </StatusSection>

      <UsedSkillsSection skills={sessionSkills} />

      <StatusSection title="Workspace">
        <StatusRows
          rows={workspaceRows(
            activeProject,
            focusedSession,
            gitSummary ?? null,
            tools.browser.enabled,
            tools.browser.url,
          )}
        />
      </StatusSection>

      <CanvasPeek />
    </section>
  );
}

function summarizeSessions(sessions: Session[]): StatusTotals {
  const seen = new Set<string>();
  return sessions.reduce((acc, session) => {
    const key = session.piSessionId ? `pi:${session.piSessionId}` : `tab:${session.id}`;
    if (seen.has(key)) return acc;
    seen.add(key);
    return {
      read: acc.read + (session.tokenStats?.read ?? 0),
      write: acc.write + (session.tokenStats?.write ?? 0),
      current: Math.max(acc.current, session.tokenStats?.current ?? 0),
      messages: acc.messages + session.messages.length,
      queued: acc.queued + (session.queue?.length ?? 0),
      running: acc.running + (isSessionRunning(session) ? 1 : 0),
    };
  }, initialStatusTotals());
}

function initialStatusTotals(): StatusTotals {
  return { read: 0, write: 0, current: 0, messages: 0, queued: 0, running: 0 };
}

function sessionTitle(session: Session | null): string {
  return session?.title ?? "New session";
}

function sessionTokenCount(session: Session | null): number {
  return session?.tokenStats?.current ?? 0;
}

function sessionTopRows(activeModel: AgentModel | null, session: Session | null): StatusRowData[] {
  const sessionTokens = sessionTokenCount(session);
  const contextWindow = activeModel?.contextWindow ?? 0;
  return [
    { label: "State", value: session?.status ?? "idle" },
    { label: "Model", value: activeModel?.name ?? session?.modelId ?? "No model" },
    {
      label: "Context",
      value: `${formatTokenCount(sessionTokens)} / ${formatTokenCount(contextWindow)}`,
    },
  ];
}

function sessionBottomRows(totals: StatusTotals): StatusRowData[] {
  return [
    {
      label: "Read / write",
      value: `${formatTokenCount(totals.read)} / ${formatTokenCount(totals.write)}`,
    },
    { label: "Queue", value: `${totals.queued} queued · ${totals.running} running` },
  ];
}

function workspaceRows(
  activeProject: Project | null,
  session: Session | null,
  gitSummary: GitSummary,
  browserEnabled: boolean,
  browserUrl: string,
): StatusRowData[] {
  return [
    { label: "Project", value: activeProject?.name ?? "No project" },
    { label: "Directory", value: activeProject?.path ?? session?.cwd ?? "No directory" },
    { label: "Git", value: formatGitSummary(gitSummary) },
    { label: "Browser", value: browserEnabled ? browserUrl : "Tool off" },
  ];
}

function isCompactDisabled(
  activeModel: AgentModel | null,
  session: Session | null,
  compacting: boolean,
  hasCompactAction: boolean,
): boolean {
  return (
    compacting ||
    isSessionRunning(session) ||
    !session?.piSessionId ||
    !activeModel ||
    !hasCompactAction
  );
}

function shouldCompactSession(session: Session | null): boolean {
  return Boolean(session?.contextUsage?.shouldCompact);
}

function compactTitle(highlighted: boolean): string {
  return highlighted ? "Context near limit - compact this session" : "Compact this session context";
}

function isSessionRunning(session: Session | null): boolean {
  return session?.status === "running" || session?.status === "starting";
}

function StatusRows({ rows }: { rows: StatusRowData[] }) {
  return rows.map((row) => <StatusRow key={row.label} label={row.label} value={row.value} />);
}

function usedSkillsForSession(session: Session | null): ComposerSkillRef[] {
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of session?.usedSkills ?? []) {
    const key = skill.id || skill.path || skill.name;
    if (!byId.has(key)) byId.set(key, skill);
  }
  for (const message of session?.messages ?? []) {
    for (const skill of message.skills ?? []) {
      const key = skill.id || skill.path || skill.name;
      if (!byId.has(key)) byId.set(key, skill);
    }
  }
  return [...byId.values()];
}

function UsedSkillsSection({ skills }: { skills: ComposerSkillRef[] }) {
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 flex items-center gap-2 text-[length:var(--fs-xs)] uppercase tracking-wide text-(--dim)">
        <span>Skills · session</span>
        <span className="font-mono normal-case tracking-normal">{skills.length}</span>
      </div>
      {skills.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--border) px-2 py-1.5 text-[length:var(--fs-xs)] text-(--dim)">
          No skills used in this session yet.
        </div>
      ) : (
        <ul className="grid gap-0.5">
          {skills.map((skill) => (
            <li
              key={skill.id || skill.path || skill.name}
              className="flex min-w-0 items-center gap-2 py-0.5 text-[length:var(--fs-sm)]"
              title={skill.path}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/75" />
              <span className="min-w-0 flex-1 truncate font-mono text-(--fg)">{skill.name}</span>
              <span className="shrink-0 truncate text-[length:var(--fs-xs)] text-(--dim)">
                {skill.source ?? "skill"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatGitSummary(gitSummary: GitSummary): string {
  if (!gitSummary?.isRepo) return "Not a repo";
  return `${gitSummary.branch ?? "detached"} · +${gitSummary.additions} -${gitSummary.deletions} · ${gitSummary.statusCount} files`;
}

function SessionSummary({
  title,
  sessionTokens,
  allTokens,
  messageCount,
}: {
  title: string;
  sessionTokens: number;
  allTokens: number;
  messageCount: number;
}) {
  return (
    <div className="border-b border-(--border) pb-3">
      <div className="truncate text-sm font-medium text-(--fg)">{title}</div>
      <div className="mt-2 grid grid-cols-3 gap-3 font-mono">
        <MiniStat label="session" value={formatTokenCount(sessionTokens)} />
        <MiniStat label="max" value={formatTokenCount(allTokens)} />
        <MiniStat label="msgs" value={String(messageCount)} />
      </div>
    </div>
  );
}

function CanvasPeek() {
  const tools = useTools();
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="flex h-8 items-center gap-2">
        <Code2 className="h-3.5 w-3.5 text-(--accent)" />
        <span className="font-medium text-(--fg)">Canvas</span>
        <button
          type="button"
          onClick={() => tools.setComputerTab("canvas")}
          className="ml-auto h-6 rounded px-2 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          Open
        </button>
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[length:var(--fs-sm)] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)"
              : "bg-(--bg) text-(--dim) hover:text-(--fg)"
          }`}
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="mt-2 max-h-28 overflow-hidden rounded-md bg-(--surface)/50 p-2 font-mono text-[length:var(--fs-sm)] leading-5 text-(--dim)">
        {tools.computer.canvasText.trim() || "No canvas notes yet."}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[length:var(--fs-2xs)] uppercase tracking-wide text-(--dim)">
        {label}
      </div>
      <div className="mt-1 truncate text-[length:var(--fs-base)] text-(--fg)">{value}</div>
    </div>
  );
}

function StatusSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 text-[length:var(--fs-xs)] uppercase tracking-wide text-(--dim)">
        {title}
      </div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-0.5">
      <span className="text-[length:var(--fs-xs)] text-(--dim)">{label}</span>
      <span
        className="min-w-0 truncate text-right font-mono text-[length:var(--fs-sm)] text-(--fg)"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusActionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-0.5">
      <span className="text-[length:var(--fs-xs)] text-(--dim)">{label}</span>
      <span className="flex min-w-0 justify-end">{children}</span>
    </div>
  );
}
