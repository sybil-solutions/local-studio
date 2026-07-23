"use client";

import { Button, SearchInput, SegmentedControl } from "@/ui";
import { Clock, Plus } from "@/ui/icon-registry";
import type { Automation } from "@shared/agent/automation";
import {
  filterAutomations,
  relativeTime,
  scheduleLabel,
  type AutomationFilter,
} from "./automation-model";

export function AutomationList({
  automations,
  loading,
  query,
  filter,
  selectedId,
  onQueryChange,
  onFilterChange,
  onCreate,
  onSelect,
}: {
  automations: readonly Automation[];
  loading: boolean;
  query: string;
  filter: AutomationFilter;
  selectedId: string | null;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: AutomationFilter) => void;
  onCreate: () => void;
  onSelect: (automation: Automation) => void;
}) {
  const visible = filterAutomations(automations, query, filter);

  return (
    <section className="flex min-h-0 w-full shrink-0 flex-col border-r border-(--ui-border) bg-(--ui-bg)">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--ui-border) px-4">
        <div className="min-w-0">
          <h1 className="truncate text-[length:var(--fs-xl)] font-medium text-(--ui-fg)">
            Automations
          </h1>
          <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">
            {automations.length} scheduled {automations.length === 1 ? "task" : "tasks"}
          </p>
        </div>
        <Button size="sm" onClick={onCreate} icon={<Plus className="h-3.5 w-3.5" />}>
          New
        </Button>
      </header>

      <div className="shrink-0 space-y-2 border-b border-(--ui-separator) p-3">
        <SearchInput value={query} onChange={onQueryChange} placeholder="Search automations" />
        <SegmentedControl
          value={filter}
          onChange={onFilterChange}
          size="sm"
          items={[
            { id: "all", label: "All" },
            { id: "active", label: "Active" },
            { id: "paused", label: "Paused" },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <ListMessage>Loading scheduled tasks…</ListMessage>
        ) : visible.length === 0 ? (
          <ListMessage>
            {automations.length === 0
              ? "No automations yet. Create one to run work on a schedule."
              : "No automations match these filters."}
          </ListMessage>
        ) : (
          <div role="list" className="divide-y divide-(--ui-separator)/70">
            {visible.map((automation) => {
              const selected = automation.id === selectedId;
              const paused = automation.status === "paused";
              return (
                <button
                  key={automation.id}
                  type="button"
                  role="listitem"
                  onClick={() => onSelect(automation)}
                  className={`group w-full rounded-[var(--ui-radius)] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35 ${
                    selected
                      ? "bg-(--ui-active) text-(--ui-fg)"
                      : "text-(--ui-fg) hover:bg-(--ui-hover)/60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        paused
                          ? "bg-(--ui-muted)/45"
                          : automation.lastRun?.outcome === "error"
                            ? "bg-(--ui-danger)"
                            : "bg-(--ui-accent)"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-base)] font-medium">
                          {automation.name}
                        </span>
                        {automation.unread ? (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--ui-accent)"
                            aria-label="Unread run"
                          />
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">{scheduleLabel(automation.schedule)}</span>
                      </span>
                      <span className="mt-1 block truncate text-[length:var(--fs-xs)] text-(--ui-muted)/75">
                        {paused ? "Paused" : `Next run ${relativeTime(automation.nextRunAt)}`}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ListMessage({ children }: { children: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center px-8 text-center text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
      {children}
    </div>
  );
}
