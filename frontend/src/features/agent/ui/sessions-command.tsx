"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/ui/icon-registry";
import { ChatIcon, Folder } from "@/ui/icons";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

import { type ActiveSession, indexOpenByThreadId } from "@/features/agent/session-contracts";
import type { AggregatedSession } from "@shared/agent/session-summary";

type Props = {
  open: boolean;
  onClose: () => void;
  activeSessions: readonly ActiveSession[];
};

type AppDestination = {
  href: string;
  label: string;
  keywords: string;
  description: string;
};

const APP_DESTINATIONS: AppDestination[] = [
  {
    href: "/",
    label: "Status",
    keywords: "dashboard controller gpu metrics decode prefill throughput live historic",
    description: "Controller, GPU, model status, and live metrics.",
  },
  {
    href: "/usage",
    label: "Usage",
    keywords: "tokens requests analytics costs provider pi sessions peaks",
    description: "Token, request, and model usage analytics.",
  },
  {
    href: "/recipes",
    label: "Models",
    keywords: "models recipes launch downloads search hugging face explore",
    description: "Search models, manage recipes, launches, and downloads.",
  },
  {
    href: "/configure",
    label: "Configure",
    keywords: "engine runtime launch parameters presets templates",
    description: "Configure model engines and launch parameters.",
  },
  {
    href: "/agent",
    label: "Workbench",
    keywords: "agent chat projects browser terminal tools canvas files",
    description: "Project-aware chat, terminals, files, and tools.",
  },
  {
    href: "/integrations",
    label: "Integrations",
    keywords: "mcp connectors plugins skills tools services accounts",
    description: "Connect MCP tools and inspect local skills.",
  },
  {
    href: "/server",
    label: "Server",
    keywords: "logs api docs swagger controller endpoints",
    description: "Server logs and controller API documentation.",
  },
  {
    href: "/agent/sessions",
    label: "Chat history",
    keywords: "history archived transcripts pi sessions runs",
    description: "Search and inspect stored agent sessions.",
  },
  {
    href: "/settings",
    label: "Settings",
    keywords: "connection system appearance archived chats skills setup configuration",
    description: "Connection, system, appearance, skills, and setup.",
  },
];

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  return `${Math.floor(delta / day)}d`;
}

function isRunning(status: string): boolean {
  return Boolean(status) && status !== "idle" && status !== "done";
}

export function SessionsCommand({ open, onClose, activeSessions }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<AggregatedSession[] | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useMountSubscription(() => {
    if (!open) return;
    let cancelled = false;
    void import("@/features/agent/ui/sessions-command-effects")
      .then((mod) => mod.loadAggregatedSessions())
      .then((nextSessions) => {
        if (!cancelled) setSessions(nextSessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useMountSubscription(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setQuery("");
      setHighlight(0);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const openByThreadId = useMemo(() => indexOpenByThreadId(activeSessions), [activeSessions]);

  const liveOnlyActives = useMemo(
    () => activeSessions.filter((session) => isRunning(session.status)),
    [activeSessions],
  );

  const filtered = useMemo(() => {
    const all = sessions ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    return all
      .filter((session) => {
        const haystack =
          `${session.firstUserMessage ?? ""} ${session.projectName} ${session.modelId ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 80);
  }, [sessions, query]);

  const destinationFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return APP_DESTINATIONS.slice(0, 8);
    return APP_DESTINATIONS.filter((destination) =>
      `${destination.label} ${destination.keywords} ${destination.description}`
        .toLowerCase()
        .includes(q),
    ).slice(0, 8);
  }, [query]);

  const liveFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveOnlyActives;
    return liveOnlyActives.filter((session) =>
      `${session.title} ${session.status}`.toLowerCase().includes(q),
    );
  }, [liveOnlyActives, query]);

  const totalRows = destinationFiltered.length + liveFiltered.length + filtered.length;
  const selectedIndex = totalRows > 0 ? Math.min(highlight, totalRows - 1) : 0;

  if (!open) return null;

  function commit(index: number) {
    if (index < 0) return;
    if (index < destinationFiltered.length) {
      const destination = destinationFiltered[index];
      if (!destination) return;
      router.push(destination.href);
      onClose();
      return;
    }
    const liveIndex = index - destinationFiltered.length;
    if (liveIndex < liveFiltered.length) {
      const session = liveFiltered[liveIndex];
      router.push(
        `/agent?project=${encodeURIComponent(session.projectId)}${
          session.threadId ? `&session=${encodeURIComponent(session.threadId)}` : ""
        }&replace=1`,
      );
      onClose();
      return;
    }
    const session = filtered[index - destinationFiltered.length - liveFiltered.length];
    if (!session) return;
    router.push(
      `/agent?project=${encodeURIComponent(session.projectId)}&session=${encodeURIComponent(session.id)}&replace=1`,
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-(--color-background)"
        onClick={onClose}
        aria-label="Close session search"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[68vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-2xl border border-(--color-popover-border) bg-(--color-popover) shadow-[0_24px_80px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.035)]"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((h) => Math.min(totalRows - 1, h + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            commit(selectedIndex);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-(--separator) px-4 py-3">
          <Search className="h-4 w-4 text-(--dim)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            placeholder="Search destinations, sessions, projects, or models…"
            className="flex-1 bg-transparent text-[length:var(--fs-lg)] text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5 text-[length:var(--fs-xs)] text-(--dim)">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {sessions === null ? (
            <div className="px-4 py-6 text-[length:var(--fs-md)] text-(--dim)">
              Loading sessions…
            </div>
          ) : totalRows === 0 ? (
            <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--dim)">
              No destinations or sessions match “{query}”.
            </div>
          ) : (
            <>
              {destinationFiltered.length > 0 ? (
                <SectionLabel>App destinations</SectionLabel>
              ) : null}
              {destinationFiltered.map((destination, index) => {
                const active = selectedIndex === index;
                return (
                  <button
                    key={destination.href}
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => commit(index)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-(--fg)">{destination.label}</span>
                      <span className="mt-0.5 block truncate text-[length:var(--fs-sm)] text-(--dim)">
                        {destination.description}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[length:var(--fs-sm)] text-(--dim)">
                      {destination.href}
                    </span>
                  </button>
                );
              })}
              {liveFiltered.length > 0 ? <SectionLabel>Running now</SectionLabel> : null}
              {liveFiltered.map((session, index) => {
                const i = destinationFiltered.length + index;
                const active = selectedIndex === i;
                return (
                  <button
                    key={`live:${session.id}`}
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-(--hl2) animate-pulse"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-(--fg)">
                      {cleanSessionTitle(session.title) || "Current session"}
                    </span>
                    <span className="shrink-0 truncate text-[length:var(--fs-sm)] text-(--dim)">
                      {session.status}
                    </span>
                  </button>
                );
              })}
              {filtered.length > 0 ? <SectionLabel>Recent sessions</SectionLabel> : null}
              {filtered.map((session, index) => {
                const i = destinationFiltered.length + liveFiltered.length + index;
                const active = selectedIndex === i;
                const running = openByThreadId.has(session.id);
                const label =
                  cleanSessionTitle(session.firstUserMessage) ||
                  `Session ${session.id.slice(0, 8)}`;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    {running ? (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-(--hl2) animate-pulse"
                        aria-hidden
                      />
                    ) : (
                      <ChatIcon className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-(--fg)">{label}</span>
                    <span className="inline-flex items-center gap-1 shrink-0 truncate text-[length:var(--fs-sm)] text-(--dim)">
                      <Folder className="h-3 w-3" />
                      {session.projectName}
                    </span>
                    <span className="w-12 shrink-0 text-right text-[length:var(--fs-sm)] text-(--dim)">
                      {formatRelative(session.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-(--separator) px-4 py-2 text-[length:var(--fs-sm)] text-(--dim)">
          <span>
            {totalRows} result{totalRows === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5">↑</kbd>
            <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5">↓</kbd>
            navigate
            <kbd className="ml-2 rounded bg-(--surface-2) px-1.5 py-0.5">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[length:var(--fs-xs)] font-medium uppercase tracking-[var(--section-tracking)] text-(--dim)">
      {children}
    </div>
  );
}
