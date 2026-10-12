"use client";

import { useState } from "react";
import { Button, FormField, Input, Select, Textarea } from "@/ui";
import { Clock, Pause, Play, Plus, Trash2, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Automation, AutomationSchedule } from "@shared/agent/automation";
import type { AutomationModel } from "./automation-api";
import { AutomationRunHistory } from "./automation-run-history";
import { AutomationSessionPicker } from "./automation-session-picker";
import {
  NEW_AUTOMATION_DRAFT,
  draftFromAutomation,
  draftIsValid,
  relativeTime,
  scheduleLabel,
  type AutomationDraft,
} from "./automation-model";

type EditorAction = "save" | "run" | "status" | "delete" | "clearRuns" | null;

const EXAMPLES: Array<{
  label: string;
  draft: Pick<AutomationDraft, "name" | "prompt" | "schedule">;
}> = [
  {
    label: "Daily brief",
    draft: {
      name: "Daily brief",
      prompt: "Review my recent work and summarize priorities, blockers, and next actions.",
      schedule: { kind: "daily", time: "08:00", weekdaysOnly: true },
    },
  },
  {
    label: "Weekly review",
    draft: {
      name: "Weekly review",
      prompt: "Review what I worked on this week and draft a concise status update.",
      schedule: { kind: "weekly", day: 5, time: "16:00" },
    },
  },
  {
    label: "Follow-up monitor",
    draft: {
      name: "Follow-up monitor",
      prompt: "Review recent activity and flag anything that needs my attention.",
      schedule: { kind: "interval", minutes: 60 },
    },
  },
];

export function AutomationEditor({
  automation,
  creating,
  initialDraft,
  models,
  action,
  error,
  onClose,
  onSave,
  onRun,
  onToggleStatus,
  onDelete,
  onClearRuns,
}: {
  automation: Automation | null;
  creating: boolean;
  /** Seed for a new automation, so a caller can prefill it from its context. */
  initialDraft?: AutomationDraft;
  models: readonly AutomationModel[];
  action: EditorAction;
  error: string;
  onClose: () => void;
  onSave: (draft: AutomationDraft) => void;
  onRun?: () => void;
  onToggleStatus?: () => void;
  onDelete?: () => void;
  onClearRuns?: () => void;
}) {
  const [draft, setDraft] = useState<AutomationDraft>(
    () => (automation ? draftFromAutomation(automation) : initialDraft) ?? NEW_AUTOMATION_DRAFT,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  useMountSubscription(() => {
    if (draft.modelId || models.length === 0) return;
    setDraft((current) => ({ ...current, modelId: models[0]?.id ?? "" }));
  }, [draft.modelId, models]);

  const updateSchedule = (schedule: AutomationSchedule) => {
    setDraft((current) => ({ ...current, schedule }));
  };
  const busy = action !== null;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--ui-bg)">
      {/* The form wraps the header so the primary action can sit up there and
          still submit it. The header is the flex column's fixed row and the
          fields scroll under it, which is what keeps Save reachable however
          long the run history grows. */}
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftIsValid(draft) && !busy) onSave(draft);
        }}
      >
        <EditorHeader
          automation={automation}
          creating={creating}
          action={action}
          busy={busy}
          canSave={draftIsValid(draft)}
          onClose={onClose}
          onRun={onRun}
          onToggleStatus={onToggleStatus}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl space-y-5 px-5 py-5 sm:px-7">
            {creating ? (
              <ExamplePicker onSelect={(example) => setDraft(example)} draft={draft} />
            ) : null}

            <div className="space-y-4">
              <FormField label="Name" required>
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Daily brief"
                  autoFocus={creating}
                />
              </FormField>
              <FormField
                label="Task"
                required
                description="Local Studio sends this instruction to the selected model on every run."
              >
                <Textarea
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, prompt: event.target.value }))
                  }
                  placeholder="What should the agent do?"
                  rows={8}
                  className="resize-y"
                />
              </FormField>
            </div>

            <div className="border-t border-(--ui-separator) pt-5">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-(--ui-muted)" />
                <div>
                  <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                    Schedule
                  </h3>
                  <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {scheduleLabel(draft.schedule)}
                  </p>
                </div>
              </div>
              <ScheduleEditor schedule={draft.schedule} onChange={updateSchedule} />
            </div>

            <div className="grid gap-4 border-t border-(--ui-separator) pt-5 sm:grid-cols-2">
              <FormField label="Model" required>
                <Select
                  value={draft.modelId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, modelId: event.target.value }))
                  }
                >
                  {models.length === 0 ? <option value="">No models available</option> : null}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="Working directory"
                description="Optional. Leave empty to use the Local Studio default."
              >
                <Input
                  value={draft.cwd}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, cwd: event.target.value }))
                  }
                  placeholder="/path/to/project"
                />
              </FormField>
            </div>

            <FormField
              label="Run in"
              asGroup
              description="A fresh session starts blank every time. Pick an existing chat to run the task inside that thread's context instead."
            >
              <AutomationSessionPicker
                value={draft.targetSessionId}
                onChange={(targetSessionId) =>
                  setDraft((current) => ({ ...current, targetSessionId }))
                }
              />
            </FormField>

            {!creating && automation?.runs.length ? (
              <AutomationRunHistory
                automation={automation}
                clearing={action === "clearRuns"}
                busy={busy}
                onClearRuns={onClearRuns}
              />
            ) : null}

            {error ? <EditorError error={error} /> : null}

            {!creating && automation ? (
              <DeleteRow
                action={action}
                busy={busy}
                confirmDelete={confirmDelete}
                onConfirmDelete={() => setConfirmDelete(true)}
                onCancelDelete={() => setConfirmDelete(false)}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        </div>
      </form>
    </section>
  );
}

/**
 * Name, state and every non-destructive action, pinned above the scroll area.
 *
 * Saving used to be the last thing on the page, below a run history that grows
 * to twenty entries — so committing an edit meant scrolling past every run.
 * Delete deliberately stays down at the bottom of the form: it is the one
 * action that should not sit a few pixels from Save.
 */
function EditorHeader({
  automation,
  creating,
  action,
  busy,
  canSave,
  onClose,
  onRun,
  onToggleStatus,
}: {
  automation: Automation | null;
  creating: boolean;
  action: EditorAction;
  busy: boolean;
  canSave: boolean;
  onClose: () => void;
  onRun?: () => void;
  onToggleStatus?: () => void;
}) {
  const statusText = creating
    ? "Set up the work once, then let Local Studio run it."
    : automation?.status === "paused"
      ? "Paused"
      : `Next run ${relativeTime(automation?.nextRunAt ?? null)}`;
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-(--ui-border) px-4 py-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
          {creating ? "New scheduled task" : automation?.name}
        </h2>
        <p className="truncate text-[length:var(--fs-xs)] text-(--ui-muted)">{statusText}</p>
      </div>
      {!creating && automation ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={action === "run"}
            disabled={busy}
            onClick={onRun}
            icon={<Play className="h-3.5 w-3.5" />}
            aria-label="Run now"
          >
            {/* Labels step aside on a phone; the icons carry the meaning and the
                primary action keeps its width. */}
            <span className="hidden sm:inline">Run now</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={action === "status"}
            disabled={busy}
            onClick={onToggleStatus}
            icon={
              automation.status === "paused" ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )
            }
            aria-label={automation.status === "paused" ? "Resume" : "Pause"}
          >
            <span className="hidden sm:inline">
              {automation.status === "paused" ? "Resume" : "Pause"}
            </span>
          </Button>
        </>
      ) : null}
      <Button type="submit" size="sm" loading={action === "save"} disabled={!canSave || busy}>
        {creating ? "Create" : "Save"}
        <span className="hidden sm:inline">{creating ? " automation" : " changes"}</span>
      </Button>
      <Button
        type="button"
        variant="icon"
        size="sm"
        onClick={onClose}
        aria-label="Close automation details"
      >
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function ExamplePicker({
  draft,
  onSelect,
}: {
  draft: AutomationDraft;
  onSelect: (draft: AutomationDraft) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">
        Start from
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => onSelect({ ...draft, ...example.draft })}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-(--ui-fg)/5 px-3 text-[length:var(--fs-sm)] text-(--ui-muted) transition-colors hover:bg-(--ui-fg)/10 hover:text-(--ui-fg)"
          >
            <Plus className="h-3 w-3" />
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorError({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="rounded-[10px] bg-(--ui-danger)/10 px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-danger)"
    >
      {error}
    </div>
  );
}

/**
 * Delete, kept at the far end of the form and behind a confirm — deliberately
 * nowhere near the header where Save now lives.
 */
function DeleteRow({
  action,
  busy,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
}: {
  action: EditorAction;
  busy: boolean;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-(--ui-border) pt-6">
      {confirmDelete ? (
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={action === "delete"}
            disabled={busy}
            onClick={onDelete}
          >
            Delete this automation
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancelDelete}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onConfirmDelete}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="text-(--ui-danger)"
        >
          Delete automation
        </Button>
      )}
    </div>
  );
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: AutomationSchedule;
  onChange: (schedule: AutomationSchedule) => void;
}) {
  const mode = schedule.kind === "daily" && schedule.weekdaysOnly ? "weekdays" : schedule.kind;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Repeat">
        <Select
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "interval") onChange({ kind: "interval", minutes: 60 });
            else if (next === "weekly") onChange({ kind: "weekly", day: 1, time: "08:00" });
            else
              onChange({
                kind: "daily",
                time: "08:00",
                ...(next === "weekdays" ? { weekdaysOnly: true } : {}),
              });
          }}
        >
          <option value="interval">Every few minutes or hours</option>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
        </Select>
      </FormField>
      {schedule.kind === "interval" ? (
        <FormField label="Every">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={schedule.minutes}
              onChange={(event) =>
                onChange({
                  kind: "interval",
                  minutes: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
            <span className="shrink-0 text-[length:var(--fs-sm)] text-(--ui-muted)">minutes</span>
          </div>
        </FormField>
      ) : (
        <FormField label="At">
          <Input
            type="time"
            value={schedule.time}
            onChange={(event) => onChange({ ...schedule, time: event.target.value })}
          />
        </FormField>
      )}
      {schedule.kind === "weekly" ? (
        <FormField label="On">
          <Select
            value={String(schedule.day)}
            onChange={(event) =>
              onChange({ ...schedule, day: Number.parseInt(event.target.value, 10) })
            }
          >
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
              (day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ),
            )}
          </Select>
        </FormField>
      ) : null}
    </div>
  );
}
