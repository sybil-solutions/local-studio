"use client";

import { useCallback, useMemo, useState } from "react";
import { SearchInput } from "@/ui";
import { Check, ChevronDown, MessageSquare } from "@/ui/icon-registry";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  formatRelative,
  orderByRecency,
  recentsTimestamp,
} from "@/features/agent/ui/session-recency";
import { loadAggregatedSessions } from "@/features/agent/ui/sessions-command-effects";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { AggregatedSession } from "@shared/agent/session-summary";

/** Enough rows to scroll through; the search box is how you reach the rest. */
const MAX_ROWS = 40;

type LoadState = "idle" | "loading" | "ready";

function sessionTitle(session: AggregatedSession): string {
  return (
    cleanSessionTitle(session.firstUserMessage) ||
    cleanSessionTitle(session.lastUserPromptText ?? "") ||
    `Session ${session.id.slice(0, 8)}`
  );
}

/** The last thing asked in the thread, which is what makes one recognisable —
 *  suppressed when it is the same text the title already shows. */
function sessionPreview(session: AggregatedSession, title: string): string {
  const prompt = cleanSessionTitle(session.lastUserPromptText ?? "");
  if (!prompt || prompt === title) return session.projectName;
  return prompt.length > 90 ? `${prompt.slice(0, 90).trimEnd()}…` : prompt;
}

/** formatRelative speaks in bare deltas ("5m"), which only reads as a time when
 *  it is not already a phrase. */
function lastActive(session: AggregatedSession): string {
  const relative = formatRelative(recentsTimestamp(session));
  if (!relative) return "never run";
  return relative === "just now" ? relative : `${relative} ago`;
}

function matches(session: AggregatedSession, query: string): boolean {
  if (!query) return true;
  return [
    sessionTitle(session),
    session.lastUserPromptText ?? "",
    session.projectName,
    session.projectPath,
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

/**
 * Pick the thread an automation runs inside.
 *
 * Sessions are loaded on demand — opening the picker, or arriving with one
 * already attached so its name can be shown instead of its id. Ordering is
 * orderByRecency, the same last-prompt ordering the sidebar recents use, so a
 * thread sits in the same place in both lists.
 */
export function AutomationSessionPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (sessionId: string | null) => void;
}) {
  const [sessions, setSessions] = useState<AggregatedSession[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    if (loadState !== "idle") return;
    setLoadState("loading");
    void loadAggregatedSessions()
      .then((loaded) => setSessions(loaded))
      .catch(() => setSessions([]))
      .finally(() => setLoadState("ready"));
  }, [loadState]);

  // A saved automation names its session by id only; resolve it up front so the
  // field reads as a thread rather than an opaque handle.
  useMountSubscription(() => {
    if (value) load();
  }, [value, load]);

  const rows = useMemo(() => {
    const visible = sessions.filter(
      (session) => !session.archived && !session.parentSessionId && !session.subagentName,
    );
    const normalized = query.trim().toLocaleLowerCase();
    return orderByRecency(visible)
      .filter((session) => matches(session, normalized))
      .slice(0, MAX_ROWS);
  }, [sessions, query]);

  const selected = useMemo(
    () => (value ? (sessions.find((session) => session.id === value) ?? null) : null),
    [sessions, value],
  );

  return (
    <div className="overflow-hidden rounded-[10px] border border-(--ui-separator) bg-(--ui-surface)">
      <button
        type="button"
        onClick={() => {
          if (!open) load();
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-(--ui-hover)/50"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-(--ui-muted)" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--fs-sm)] text-(--ui-fg)">
            {value
              ? selected
                ? sessionTitle(selected)
                : `Session ${value.slice(0, 8)}`
              : "New session each run"}
          </span>
          <span className="block truncate text-[length:var(--fs-xs)] text-(--ui-muted)">
            {value
              ? selected
                ? `${selected.projectName} · last active ${lastActive(selected)}`
                : loadState === "ready"
                  ? "This session is no longer on this machine — runs fall back to a new session."
                  : "Loading session…"
              : "Each run starts with an empty context."}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-(--ui-muted) transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-t border-(--ui-separator)">
          <div className="p-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Search sessions" />
          </div>
          <div className="max-h-64 overflow-y-auto border-t border-(--ui-separator)">
            <PickerRow
              title="New session each run"
              subtitle="The default: no memory of earlier runs."
              selected={value === null}
              onSelect={() => {
                onChange(null);
                setOpen(false);
              }}
            />
            {loadState !== "ready" ? (
              <PickerMessage>Loading sessions…</PickerMessage>
            ) : rows.length === 0 ? (
              <PickerMessage>
                {sessions.length === 0 ? "No sessions found." : "No sessions match this search."}
              </PickerMessage>
            ) : (
              rows.map((session) => {
                const title = sessionTitle(session);
                return (
                  <PickerRow
                    key={session.id}
                    title={title}
                    subtitle={sessionPreview(session, title)}
                    meta={formatRelative(recentsTimestamp(session))}
                    selected={session.id === value}
                    onSelect={() => {
                      onChange(session.id);
                      setOpen(false);
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerRow({
  title,
  subtitle,
  meta,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
        selected ? "bg-(--ui-active)" : "hover:bg-(--ui-hover)/50"
      }`}
    >
      <Check
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${selected ? "text-(--ui-accent)" : "text-transparent"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--fs-sm)] text-(--ui-fg)">{title}</span>
        <span className="block truncate text-[length:var(--fs-xs)] text-(--ui-muted)">
          {subtitle}
        </span>
      </span>
      {meta ? (
        <span className="shrink-0 pt-0.5 text-[length:var(--fs-xs)] tabular-nums text-(--ui-muted)">
          {meta}
        </span>
      ) : null}
    </button>
  );
}

function PickerMessage({ children }: { children: string }) {
  return (
    <p className="px-3 py-4 text-center text-[length:var(--fs-xs)] text-(--ui-muted)">{children}</p>
  );
}
