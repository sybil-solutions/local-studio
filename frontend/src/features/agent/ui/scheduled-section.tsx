"use client";

// "Scheduled" sidebar section (the Codex model): automations that run
// headless on a cadence, with unread badges, run-now, pause, and a minimal
// creation dialog. Self-contained: fetches from /api/agent/automations.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Pause, Play, Plus, X as XIcon } from "@/ui/icon-registry";
import { Input, Spinner, UiModal, UiModalHeader } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type AutomationSchedule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; weekdaysOnly?: boolean }
  | { kind: "weekly"; day: number; time: string };

type Automation = {
  id: string;
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  schedule: AutomationSchedule;
  status: "active" | "paused";
  nextRunAt: string | null;
  lastRun: {
    at: string;
    piSessionId: string | null;
    outcome: "ok" | "error";
    error?: string;
  } | null;
  unread: boolean;
};

const SCHEDULE_PRESETS: Array<{ id: string; label: string; schedule: AutomationSchedule }> = [
  { id: "30m", label: "Every 30 minutes", schedule: { kind: "interval", minutes: 30 } },
  { id: "hourly", label: "Hourly", schedule: { kind: "interval", minutes: 60 } },
  { id: "daily", label: "Daily at 8:00", schedule: { kind: "daily", time: "08:00" } },
  {
    id: "weekdays",
    label: "Weekdays at 8:00",
    schedule: { kind: "daily", time: "08:00", weekdaysOnly: true },
  },
  { id: "weekly", label: "Mondays at 8:00", schedule: { kind: "weekly", day: 1, time: "08:00" } },
];

function scheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.kind === "interval") {
    return schedule.minutes % 60 === 0 && schedule.minutes >= 60
      ? `Every ${schedule.minutes / 60}h`
      : `Every ${schedule.minutes}m`;
  }
  if (schedule.kind === "daily") {
    return `${schedule.weekdaysOnly ? "Weekdays" : "Daily"} ${schedule.time}`;
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[schedule.day] ?? "Mon"} ${schedule.time}`;
}

async function fetchAutomations(): Promise<Automation[]> {
  const response = await fetch("/api/agent/automations", { cache: "no-store" });
  if (!response.ok) return [];
  const payload = (await response.json()) as { automations?: Automation[] };
  return Array.isArray(payload.automations) ? payload.automations : [];
}

function NewAutomationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [presetId, setPresetId] = useState("daily");
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useMountSubscription(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/agent/models", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          models?: Array<{ id: string; name: string }>;
        };
        const list = payload.models;
        if (cancelled || !Array.isArray(list)) return;
        setModels(list);
        setModelId((current) => current || (list[0]?.id ?? ""));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const preset = SCHEDULE_PRESETS.find((entry) => entry.id === presetId) ?? SCHEDULE_PRESETS[2];
      const response = await fetch("/api/agent/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Untitled automation",
          prompt,
          modelId,
          cwd: "",
          schedule: preset?.schedule,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      onCreated();
      onClose();
      setName("");
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create automation");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <UiModal isOpen={open} onClose={onClose}>
      <UiModalHeader title="New automation" onClose={onClose} />
      <div className="space-y-3 p-4">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name (e.g. Daily brief)"
        />
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What should the agent do on each run?"
          rows={4}
          className="w-full resize-none rounded-lg border border-(--border) bg-transparent px-3 py-2 text-[length:var(--fs-base)] text-(--fg) outline-none placeholder:text-(--dim)/60 focus:border-(--link)/50"
        />
        <div className="flex gap-2">
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            className="h-8 flex-1 rounded-lg border border-(--border) bg-(--bg) px-2 text-[length:var(--fs-md)] text-(--fg) outline-none"
          >
            {SCHEDULE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            className="h-8 flex-1 rounded-lg border border-(--border) bg-(--bg) px-2 text-[length:var(--fs-md)] text-(--fg) outline-none"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
        {error ? <div className="text-[length:var(--fs-sm)] text-(--err)">{error}</div> : null}
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || !prompt.trim() || !modelId}
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-(--fg) px-3 text-[length:var(--fs-md)] text-(--bg) transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Spinner size="xs" /> : null}
          Create automation
        </button>
      </div>
    </UiModal>
  );
}

export function ScheduledSection() {
  const router = useRouter();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    void fetchAutomations()
      .then(setAutomations)
      .catch(() => undefined);
  }, []);

  useMountSubscription(() => {
    reload();
    const timer = window.setInterval(reload, 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      await fetch(`/api/agent/automations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
      reload();
    },
    [reload],
  );

  const openRun = useCallback(
    (automation: Automation) => {
      void patch(automation.id, { unread: false });
      if (automation.lastRun?.piSessionId) {
        router.push(`/agent?session=${encodeURIComponent(automation.lastRun.piSessionId)}`);
      }
    },
    [patch, router],
  );

  if (automations.length === 0 && !creating) {
    // Keep the sidebar quiet until the first automation exists, but still
    // offer the entry point.
    return (
      <div className="flex shrink-0 flex-col">
        <NewAutomationModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
        <div className="group flex h-[var(--sidebar-row-height)] items-center justify-between pl-2 pr-1.5 pt-3">
          <span className="text-[length:var(--fs-sm)] font-normal text-(--hl2)">Scheduled</span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-5 w-5 items-center justify-center rounded text-(--dim)/55 opacity-0 transition-opacity hover:text-(--fg) group-hover:opacity-100"
            title="New automation"
            aria-label="New automation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col">
      <NewAutomationModal open={creating} onClose={() => setCreating(false)} onCreated={reload} />
      <div className="group flex h-[var(--sidebar-row-height)] items-center justify-between pl-2 pr-1.5 pt-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[length:var(--fs-sm)] font-normal text-(--hl2) hover:text-(--fg)/70"
        >
          Scheduled
        </button>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-5 w-5 items-center justify-center rounded text-(--dim)/55 opacity-0 transition-opacity hover:text-(--fg) group-hover:opacity-100"
          title="New automation"
          aria-label="New automation"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {expanded
        ? automations.map((automation) => (
            <div
              key={automation.id}
              className="group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-2 pr-1.5 text-(--fg) transition-colors hover:bg-(--hover)"
            >
              <button
                type="button"
                onClick={() => openRun(automation)}
                title={`${automation.name} · ${scheduleLabel(automation.schedule)}${
                  automation.lastRun?.outcome === "error" ? " · last run failed" : ""
                }`}
                className="flex min-w-0 flex-1 items-center gap-2 pr-12 text-left"
              >
                <Clock
                  className={`h-3.5 w-3.5 shrink-0 ${
                    automation.status === "paused" ? "opacity-40" : "opacity-70"
                  }`}
                  strokeWidth={1.75}
                />
                <span
                  className={`truncate text-[length:var(--fs-md)] font-normal ${
                    automation.status === "paused" ? "text-(--dim)" : ""
                  }`}
                >
                  {automation.name}
                </span>
                {automation.unread ? (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      automation.lastRun?.outcome === "error" ? "bg-(--err)" : "bg-(--link)"
                    }`}
                  />
                ) : null}
              </button>
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() =>
                    void fetch(`/api/agent/automations/${encodeURIComponent(automation.id)}/run`, {
                      method: "POST",
                    }).then(reload)
                  }
                  className="flex h-5 w-5 items-center justify-center text-(--dim)/55 hover:text-(--fg)"
                  title="Run now"
                  aria-label={`Run ${automation.name} now`}
                >
                  <Play className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void patch(automation.id, {
                      status: automation.status === "paused" ? "active" : "paused",
                    })
                  }
                  className="flex h-5 w-5 items-center justify-center text-(--dim)/55 hover:text-(--fg)"
                  title={automation.status === "paused" ? "Resume" : "Pause"}
                  aria-label={automation.status === "paused" ? "Resume" : "Pause"}
                >
                  {automation.status === "paused" ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void fetch(`/api/agent/automations/${encodeURIComponent(automation.id)}`, {
                      method: "DELETE",
                    }).then(reload)
                  }
                  className="flex h-5 w-5 items-center justify-center text-(--dim)/55 hover:text-(--err)"
                  title="Delete automation"
                  aria-label={`Delete ${automation.name}`}
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        : null}
    </div>
  );
}
