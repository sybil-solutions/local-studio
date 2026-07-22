"use client";

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Pin } from "@/ui/icon-registry";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "@/features/agent/contracts";
import type { AgentModel } from "@/features/agent/workspace/types";
import { cx } from "@/ui/utils";

type AgentModelPickerProps = {
  models: AgentModel[];
  selectedModel: string;
  defaultModel?: string;
  onSelect: (id: string) => void;
  onSetDefault?: (id: string) => void;
  loading: boolean;
  reasoningLevel?: AgentThinkingLevel;
  reasoningLevels?: readonly AgentThinkingLevel[];
  reasoningDisabled?: boolean;
  onSelectReasoning?: (level: AgentThinkingLevel) => void;
};

type ModelGroup = { key: string; name: string; models: AgentModel[] };
type PickerView = "root" | "models" | "reasoning";

const REASONING_LABELS: Record<AgentThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

export function AgentModelPicker({
  models,
  selectedModel,
  defaultModel,
  onSelect,
  onSetDefault,
  loading,
  reasoningLevel,
  reasoningLevels = [],
  reasoningDisabled = false,
  onSelectReasoning,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PickerView>("root");
  const active = models.find((model) => model.id === selectedModel) ?? null;
  const groups = useMemo(() => groupModelsByController(models), [models]);
  const disabled = loading;
  const modelLabel = modelTriggerLabel(active, selectedModel, loading, models.length);
  const supportsReasoning = Boolean(reasoningLevel && onSelectReasoning);
  const effectiveReasoning = reasoningLevels.includes(reasoningLevel ?? "off")
    ? (reasoningLevel ?? "off")
    : (reasoningLevels.at(-1) ?? "off");
  const reasoningLabel = REASONING_LABELS[effectiveReasoning];
  const triggerLabel = supportsReasoning ? `${modelLabel} ${reasoningLabel}` : modelLabel;
  const selectedModelNotRunning = !loading && Boolean(active && active.active === false);
  const close = useCallback(() => {
    setOpen(false);
    setView("root");
  }, []);
  const select = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      close();
    },
    [close, onSelect],
  );

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        close();
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <ModelPickerTrigger
        label={triggerLabel}
        title={active?.name || triggerLabel}
        disabled={disabled}
        open={open}
        notRunning={selectedModelNotRunning}
        onToggle={() => {
          if (disabled) return;
          if (open) close();
          else {
            setView(supportsReasoning ? "root" : "models");
            setOpen(true);
          }
        }}
      />
      {open ? (
        <div
          className="absolute bottom-full right-0 z-[300] mb-1.5 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-(--color-popover-border) bg-(--color-popover) p-1.5 shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.3),0px_0px_0px_0.5px_rgba(0,0,0,0.1)]"
          role="menu"
          aria-label="Model and reasoning"
          onKeyDown={(event) => handleMenuKeyDown(event, view, setView, close)}
        >
          {view === "root" ? (
            <PickerRoot
              modelLabel={modelLabel}
              reasoningLabel={reasoningLabel}
              reasoningFixed={reasoningLevels.length <= 1}
              onOpenModels={() => setView("models")}
              onOpenReasoning={() => setView("reasoning")}
            />
          ) : null}
          {view === "models" ? (
            <ModelList
              groups={groups}
              selectedModel={selectedModel}
              defaultModel={defaultModel}
              onBack={supportsReasoning ? () => setView("root") : undefined}
              onSelect={select}
              onSetDefault={onSetDefault}
              onClose={close}
            />
          ) : null}
          {view === "reasoning" && onSelectReasoning ? (
            <ReasoningList
              value={effectiveReasoning}
              levels={reasoningLevels}
              disabled={reasoningDisabled}
              onBack={() => setView("root")}
              onSelect={(level) => {
                onSelectReasoning(level);
                close();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PickerRoot({
  modelLabel,
  reasoningLabel,
  reasoningFixed,
  onOpenModels,
  onOpenReasoning,
}: {
  modelLabel: string;
  reasoningLabel: string;
  reasoningFixed: boolean;
  onOpenModels: () => void;
  onOpenReasoning: () => void;
}) {
  return (
    <div className="grid gap-0.5">
      <PickerRootRow label="Model" value={modelLabel} onClick={onOpenModels} />
      <PickerRootRow
        label="Reasoning"
        value={reasoningLabel}
        disabled={reasoningFixed}
        onClick={onOpenReasoning}
      />
    </div>
  );
}

function PickerRootRow({
  label,
  value,
  disabled = false,
  onClick,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 min-w-0 items-center gap-3 rounded-[10px] px-2.5 text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover) disabled:cursor-default disabled:opacity-55"
    >
      <span className="w-20 shrink-0 text-left font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-(--fg)/60">{value}</span>
      {disabled ? (
        <span className="w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 text-(--dim)" />
      )}
    </button>
  );
}

function PickerHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex h-9 items-center gap-1 border-b border-(--border) px-1 pb-1">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          aria-label="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      <span className="px-1 text-[length:var(--fs-sm)] font-medium text-(--dim)">{title}</span>
    </div>
  );
}

function ModelList({
  groups,
  selectedModel,
  defaultModel,
  onBack,
  onSelect,
  onSetDefault,
  onClose,
}: {
  groups: ModelGroup[];
  selectedModel: string;
  defaultModel?: string;
  onBack?: () => void;
  onSelect: (modelId: string) => void;
  onSetDefault?: (modelId: string) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <PickerHeader title="Model" onBack={onBack} />
      <div className="max-h-[min(24rem,55vh)] overflow-y-auto pt-1">
        {groups.length === 0 ? (
          <div className="w-64 px-2.5 py-2 text-[length:var(--fs-sm)] text-(--dim)">
            <p>No chat models are available.</p>
            <Link
              href="/models"
              onClick={onClose}
              className="mt-2 inline-flex h-7 items-center rounded-lg bg-(--active) px-2.5 text-(--fg) hover:bg-(--hover)"
            >
              Open Models
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="not-first:mt-1.5">
              {groups.length > 1 ? (
                <div className="flex h-7 items-center justify-between px-2.5 text-[length:var(--fs-xs)] font-medium text-(--dim)">
                  <span className="truncate">{group.name}</span>
                  <span className="font-mono text-[length:var(--fs-2xs)]">
                    {group.models.length}
                  </span>
                </div>
              ) : null}
              <ModelOptions
                models={group.models}
                selectedModel={selectedModel}
                defaultModel={defaultModel}
                onSelect={onSelect}
                onSetDefault={onSetDefault}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReasoningList({
  value,
  levels,
  disabled,
  onBack,
  onSelect,
}: {
  value: AgentThinkingLevel;
  levels: readonly AgentThinkingLevel[];
  disabled: boolean;
  onBack: () => void;
  onSelect: (level: AgentThinkingLevel) => void;
}) {
  return (
    <div>
      <PickerHeader title="Reasoning" onBack={onBack} />
      <div className="grid gap-0.5 pt-1">
        {AGENT_THINKING_LEVELS.filter((level) => levels.includes(level)).map((level) => (
          <button
            key={level}
            type="button"
            role="menuitemradio"
            aria-checked={level === value}
            disabled={disabled}
            onClick={() => onSelect(level)}
            className={cx(
              "flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover) disabled:opacity-45",
              level === value && "bg-(--color-input)",
            )}
          >
            <span className="flex-1">{REASONING_LABELS[level]}</span>
            {level === value ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelPickerTrigger({
  label,
  title,
  disabled,
  open,
  notRunning,
  onToggle,
}: {
  label: string;
  title: string;
  disabled: boolean;
  open: boolean;
  notRunning: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
      onClick={onToggle}
      disabled={disabled}
      className={cx(
        // Codex: the model control sits at the shared chat size (16px) with
        // primary-strength text; only the chevron reads dim.
        "group/model inline-flex !h-[30px] !min-h-[30px] !min-w-0 items-center justify-between gap-1 rounded-lg bg-transparent pl-2 pr-1.5 text-[length:var(--fs-base)] whitespace-nowrap text-(--fg)/85 transition-colors hover:bg-(--hover) hover:text-(--fg) active:translate-y-px disabled:opacity-60",
        open && "bg-(--hover) text-(--fg)",
      )}
      title={notRunning ? `${title} is not running — launch it or pick a running model` : title}
      aria-label={`Model: ${title}${notRunning ? " (not running)" : ""}`}
      aria-expanded={open}
      aria-haspopup="menu"
    >
      <span className="max-w-[180px] truncate text-left">{label}</span>
      {notRunning ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)" /> : null}
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 shrink-0 text-(--dim)" />
    </button>
  );
}

function ModelOptions({
  models,
  selectedModel,
  defaultModel,
  onSelect,
  onSetDefault,
}: {
  models: AgentModel[];
  selectedModel: string;
  defaultModel?: string;
  onSelect: (modelId: string) => void;
  onSetDefault?: (modelId: string) => void;
}) {
  return models.map((model) => (
    <ModelOption
      key={model.id}
      model={model}
      selected={model.id === selectedModel}
      isDefault={model.id === defaultModel}
      onSelect={onSelect}
      onSetDefault={onSetDefault}
    />
  ));
}

function ModelOption({
  model,
  selected,
  isDefault,
  onSelect,
  onSetDefault,
}: {
  model: AgentModel;
  selected: boolean;
  isDefault: boolean;
  onSelect: (modelId: string) => void;
  onSetDefault?: (modelId: string) => void;
}) {
  const label = model.rawId || model.name;
  return (
    <div
      className={cx(
        "flex min-h-8 w-full min-w-0 items-center rounded-[10px] text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover)",
        selected && "bg-(--color-input)",
      )}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={() => onSelect(model.id)}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] pl-2.5 text-left focus-visible:outline-none active:translate-y-px"
      >
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-(--fg)" /> : null}
      </button>
      {onSetDefault ? (
        <button
          type="button"
          onClick={() => onSetDefault(model.id)}
          aria-label={isDefault ? `${label} is the default model` : `Set ${label} as default model`}
          title={isDefault ? "Default model" : "Set as default"}
          className={cx(
            "mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--dim) transition-colors hover:bg-(--active) hover:text-(--fg) focus-visible:outline-none",
            isDefault && "text-(--fg)",
          )}
        >
          <Pin className={cx("h-3.5 w-3.5", isDefault && "fill-current")} strokeWidth={1.5} />
        </button>
      ) : null}
    </div>
  );
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  view: PickerView,
  setView: (view: PickerView) => void,
  close: () => void,
) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (view === "root" || view === "models") close();
  else setView("root");
}

function modelTriggerLabel(
  active: AgentModel | null,
  selectedModel: string,
  loading: boolean,
  modelCount: number,
): string {
  const fallbackLabel = selectedModel || (modelCount === 0 ? "No models" : "model");
  if (loading) return active?.rawId || active?.name || fallbackLabel || "Loading…";
  return active?.rawId || active?.name || fallbackLabel;
}

function controllerGroupKey(model: AgentModel): string {
  return model.controllerUrl ?? model.controllerName ?? "primary";
}

function groupModelsByController(models: AgentModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const key = controllerGroupKey(model);
    const existing = groups.get(key);
    if (existing) existing.models.push(model);
    else groups.set(key, { key, name: model.controllerName ?? "local", models: [model] });
  }
  return [...groups.values()];
}

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
