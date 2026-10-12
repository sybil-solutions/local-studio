"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "@/ui/icon-registry";
import { POPOVER_PANEL_CLASS } from "@/ui/popover";
import { ChatIcon, Folder } from "@/ui/icons";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

import { type ActiveSession, indexOpenByThreadId } from "@/features/agent/session-index";
import { formatRelative } from "@/features/agent/ui/session-recency";
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
    href: "/settings#usage",
    label: "Usage",
    keywords: "tokens requests analytics costs provider pi sessions peaks",
    description: "Token, request, and model usage analytics.",
  },
  {
    href: "/settings#mcp",
    label: "Tools & MCP",
    keywords:
      "integrations connectors mcp servers accounts google gmail workspace access grants providers cloud models sign in oauth api keys skills plugins",
    description: "MCP servers, connector access, and sign-ins.",
  },
  {
    href: "/settings#machines",
    label: "Machines",
    keywords:
      "configure machines hardware gpu memory pool server logs api docs swagger controller engines runtime",
    description: "The machines that run models, and the controller.",
  },
  {
    href: "/agent/automations",
    label: "Automations",
    keywords: "automations scheduled tasks cron wake",
    description: "Scheduled and event-driven agent runs.",
  },
  {
    href: "/agent",
    label: "Workbench",
    keywords: "agent chat projects browser terminal tools files",
    description: "Project-aware chat, terminals, files, and tools.",
  },
  {
    href: "/settings",
    label: "Settings",
    keywords: "connection system appearance theme shortcuts archived chats setup configuration",
    description: "Connection, system, appearance, and setup.",
  },
];

type PaletteRow = { key: string; section: string; href: string } & (
  | { kind: "destination"; destination: AppDestination }
  | { kind: "live"; session: ActiveSession }
  | { kind: "recent"; session: AggregatedSession }
);

function agentSessionHref(projectId: string, sessionId: string | null): string {
  const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
  return `/agent?project=${encodeURIComponent(projectId)}${sessionParam}&replace=1`;
}

function isRunning(status: string): boolean {
  return Boolean(status) && status !== "idle" && status !== "done";
}

/** ⌘K opens the centered search palette. */
export function SessionsCommand({ open, onClose, activeSessions }: Props) {
  if (!open) return null;
  return <SearchPalette open onClose={onClose} activeSessions={activeSessions} />;
}

function SearchPalette({
  open,
  onClose,
  activeSessions,
}: {
  open: boolean;
  onClose: () => void;
  activeSessions: readonly ActiveSession[];
}) {
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

  const rows = useMemo<PaletteRow[]>(
    () => [
      ...destinationFiltered.map(
        (destination): PaletteRow => ({
          kind: "destination",
          key: destination.href,
          section: "App destinations",
          href: destination.href,
          destination,
        }),
      ),
      ...liveFiltered.map(
        (session): PaletteRow => ({
          kind: "live",
          key: `live:${session.id}`,
          section: "Running now",
          href: agentSessionHref(session.projectId, session.threadId),
          session,
        }),
      ),
      ...filtered.map(
        (session): PaletteRow => ({
          kind: "recent",
          key: session.id,
          section: "Recent sessions",
          href: agentSessionHref(session.projectId, session.id),
          session,
        }),
      ),
    ],
    [destinationFiltered, liveFiltered, filtered],
  );

  const totalRows = rows.length;
  const selectedIndex = totalRows > 0 ? Math.min(highlight, totalRows - 1) : 0;

  if (!open) return null;

  function commit(index: number) {
    const row = rows[index];
    if (!row) return;
    router.push(row.href);
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
        className={`relative z-10 flex max-h-[68vh] w-[min(720px,92vw)] flex-col ${POPOVER_PANEL_CLASS}`}
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
            rows.map((row, index) => {
              const active = selectedIndex === index;
              return (
                <Fragment key={row.key}>
                  {row.section !== rows[index - 1]?.section ? (
                    <SectionLabel>{row.section}</SectionLabel>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => commit(index)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[length:var(--fs-base)] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    {row.kind === "destination" ? (
                      <DestinationRowBody destination={row.destination} />
                    ) : row.kind === "live" ? (
                      <LiveRowBody session={row.session} />
                    ) : (
                      <RecentRowBody
                        session={row.session}
                        running={openByThreadId.has(row.session.id)}
                      />
                    )}
                  </button>
                </Fragment>
              );
            })
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

function DestinationRowBody({ destination }: { destination: AppDestination }) {
  return (
    <>
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
    </>
  );
}

function LiveRowBody({ session }: { session: ActiveSession }) {
  return (
    <>
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
    </>
  );
}

function RecentRowBody({ session, running }: { session: AggregatedSession; running: boolean }) {
  const label = cleanSessionTitle(session.firstUserMessage) || `Session ${session.id.slice(0, 8)}`;
  return (
    <>
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
    </>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[length:var(--fs-sm)] font-medium text-(--dim)">
      {children}
    </div>
  );
}
