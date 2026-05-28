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
  const totals = useMemo(
    () =>
      sessions.reduce(
        (acc, session) => ({
          read: acc.read + (session.tokenStats?.read ?? 0),
          write: acc.write + (session.tokenStats?.write ?? 0),
          current: acc.current + (session.tokenStats?.current ?? 0),
          messages: acc.messages + session.messages.length,
          queued: acc.queued + (session.queue?.length ?? 0),
          running:
            acc.running + (session.status === "running" || session.status === "starting" ? 1 : 0),
        }),
        { read: 0, write: 0, current: 0, messages: 0, queued: 0, running: 0 },
      ),
    [sessions],
  );
  const contextWindow = activeModel?.contextWindow ?? 0;
  const sessionTokens = focusedSession?.tokenStats?.current ?? 0;
  const sessionRunning =
    focusedSession?.status === "running" || focusedSession?.status === "starting";
  const compactDisabled =
    compacting ||
    sessionRunning ||
    !focusedSession?.piSessionId ||
    !activeModel ||
    !onCompactSession;
  const shouldCompact = Boolean(focusedSession?.contextUsage?.shouldCompact);
  const sessionSkills = useMemo(() => usedSkillsForSession(focusedSession), [focusedSession]);
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
        title={focusedSession?.title ?? "New session"}
        sessionTokens={sessionTokens}
        allTokens={totals.current}
        messageCount={totals.messages}
      />

      <StatusSection title="Session">
        <StatusRow label="State" value={focusedSession?.status ?? "idle"} />
        <StatusRow
          label="Model"
          value={activeModel?.name ?? focusedSession?.modelId ?? "No model"}
        />
        <StatusRow
          label="Context"
          value={`${formatTokenCount(sessionTokens)} / ${formatTokenCount(contextWindow)}`}
        />
        <StatusActionRow label="Compact">
          <button
            type="button"
            onClick={() => void compactFocusedSession()}
            disabled={compactDisabled}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] ${
              shouldCompact
                ? "text-(--accent) ring-1 ring-(--accent)/40"
                : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            } disabled:pointer-events-none disabled:opacity-30`}
            title={
              shouldCompact
                ? "Context near limit - compact this session"
                : "Compact this session context"
            }
          >
            {compacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {compacting ? "Compacting" : "Compact"}
          </button>
        </StatusActionRow>
        <StatusRow
          label="Read / write"
          value={`${formatTokenCount(totals.read)} / ${formatTokenCount(totals.write)}`}
        />
        <StatusRow label="Queue" value={`${totals.queued} queued · ${totals.running} running`} />
      </StatusSection>

      <UsedSkillsSection skills={sessionSkills} />

      <StatusSection title="Workspace">
        <StatusRow label="Project" value={activeProject?.name ?? "No project"} />
        <StatusRow
          label="Directory"
          value={activeProject?.path ?? focusedSession?.cwd ?? "No directory"}
        />
        <StatusRow label="Git" value={formatGitSummary(gitSummary ?? null)} />
        <StatusRow label="Browser" value={tools.browser.enabled ? tools.browser.url : "Tool off"} />
      </StatusSection>

      <ActivePluginsSection focusedSession={focusedSession} />

      <CanvasPeek />
    </section>
  );
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
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-(--dim)">
        <span>Skills · session</span>
        <span className="font-mono normal-case tracking-normal">{skills.length}</span>
      </div>
      {skills.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--border) px-2 py-1.5 text-[10.5px] text-(--dim)">
          No skills used in this session yet.
        </div>
      ) : (
        <ul className="grid gap-0.5">
          {skills.map((skill) => (
            <li
              key={skill.id || skill.path || skill.name}
              className="flex min-w-0 items-center gap-2 py-0.5 text-[11px]"
              title={skill.path}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/75" />
              <span className="min-w-0 flex-1 truncate font-mono text-(--fg)">{skill.name}</span>
              <span className="shrink-0 truncate text-[10px] text-(--dim)">
                {skill.source ?? "skill"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivePluginsSection({ focusedSession }: { focusedSession: Session | null }) {
  const tools = useTools();
  // Compose the effective list: persisted enabled flag layered with per-turn
  // overrides from the focused session. Matches the runtime's filter logic.
  const overrides = focusedSession ? tools.selectionFor(focusedSession.id).extensionOverrides : [];
  const overrideByKey = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const entry of overrides) map.set(entry.key, entry.enabled);
    return map;
  }, [overrides]);
  const active = useMemo(
    () =>
      tools.extensionCatalogue.filter((ext) => {
        if (overrideByKey.has(ext.source)) return overrideByKey.get(ext.source);
        if (overrideByKey.has(ext.path)) return overrideByKey.get(ext.path);
        return ext.enabled;
      }),
    [overrideByKey, tools.extensionCatalogue],
  );
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-(--dim)">
        <span>Pi plugins · active</span>
        <span className="font-mono normal-case tracking-normal">{active.length}</span>
        <button
          type="button"
          onClick={() => {
            tools.setComputerTab("plugins");
            tools.setComputerOpen(true);
          }}
          className="ml-auto h-5 rounded px-1.5 text-[10px] normal-case tracking-normal text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          Manage
        </button>
      </div>
      {active.length === 0 ? (
        <div className="rounded-md border border-dashed border-(--border) px-2 py-1.5 text-[10.5px] text-(--dim)">
          No Pi extensions enabled. Type <span className="font-mono">/plugins</span> in the composer
          or install one from the panel.
        </div>
      ) : (
        <ul className="grid gap-0.5">
          {active.map((ext) => (
            <li
              key={ext.id}
              className="flex min-w-0 items-center gap-2 py-0.5 text-[11px]"
              title={ext.path}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent)/70" />
              <span className="min-w-0 flex-1 truncate font-mono text-(--fg)">{ext.name}</span>
              <span className="shrink-0 font-mono text-[9px] uppercase text-(--dim)">
                {ext.scope}
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
        <MiniStat label="all" value={formatTokenCount(allTokens)} />
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
          className="ml-auto h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          Open
        </button>
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[11px] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)"
              : "bg-(--bg) text-(--dim) hover:text-(--fg)"
          }`}
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="mt-2 max-h-28 overflow-hidden rounded-md bg-(--surface)/50 p-2 font-mono text-[11px] leading-5 text-(--dim)">
        {tools.computer.canvasText.trim() || "No canvas notes yet."}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[9px] uppercase tracking-wide text-(--dim)">{label}</div>
      <div className="mt-1 truncate text-[13px] text-(--fg)">{value}</div>
    </div>
  );
}

function StatusSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-(--dim)">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-0.5">
      <span className="text-[10px] text-(--dim)">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[11px] text-(--fg)" title={value}>
        {value}
      </span>
    </div>
  );
}

function StatusActionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-0.5">
      <span className="text-[10px] text-(--dim)">{label}</span>
      <span className="flex min-w-0 justify-end">{children}</span>
    </div>
  );
}
