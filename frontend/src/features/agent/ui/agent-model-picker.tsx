"use client";

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { Check, ChevronDown } from "@/ui/icon-registry";
import type { AgentModel } from "@/features/agent/workspace/types";
import { cx } from "@/ui/utils";

type AgentModelPickerProps = {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (id: string) => void;
  loading: boolean;
};

type ModelGroup = { key: string; name: string; models: AgentModel[] };

export function AgentModelPicker({
  models,
  selectedModel,
  onSelect,
  loading,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const active = models.find((model) => model.id === selectedModel) ?? null;
  const groups = useMemo(() => groupModelsByController(models), [models]);
  const selectedGroupKey = active ? controllerGroupKey(active) : groups[0]?.key;
  const activeGroup = groups.find((group) => group.key === activeGroupKey) ?? null;
  const disabled = loading || models.length === 0;
  const triggerLabel = modelTriggerLabel(active, selectedModel, loading, models.length);
  const selectedModelNotRunning = !loading && Boolean(active && active.active === false);
  const close = useCallback(() => {
    setOpen(false);
    setActiveGroupKey(null);
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
          else setOpen(true);
        }}
      />
      {open ? (
        <div
          className="absolute bottom-full right-0 z-10 mb-1.5 min-w-48 rounded-lg border border-(--color-popover-border) bg-(--color-popover) p-1 shadow-[0_12px_32px_rgba(0,0,0,0.48)]"
          role="menu"
          aria-label="Models"
          onKeyDown={(event) => handleMenuKeyDown(event, close)}
        >
          {groups.length > 1 ? (
            groups.map((group) => (
              <ModelGroupOption
                key={group.key}
                group={group}
                active={group.key === activeGroupKey}
                selected={group.key === selectedGroupKey}
                onActivate={() => setActiveGroupKey(group.key)}
              />
            ))
          ) : (
            <ModelOptions
              models={groups[0]?.models ?? []}
              selectedModel={selectedModel}
              onSelect={select}
            />
          )}
          {groups.length > 1 && activeGroup ? (
            <div
              className="absolute bottom-0 right-[calc(100%+4px)] max-h-72 w-max min-w-52 max-w-80 overflow-y-auto rounded-lg border border-(--color-popover-border) bg-(--color-popover) p-1 shadow-[0_12px_32px_rgba(0,0,0,0.48)]"
              role="menu"
              aria-label={activeGroup.name}
              onMouseEnter={() => setActiveGroupKey(activeGroup.key)}
            >
              <ModelOptions
                models={activeGroup.models}
                selectedModel={selectedModel}
                onSelect={select}
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
        "group/model inline-flex !h-7 !min-h-7 !min-w-0 items-center justify-between gap-1 rounded-lg bg-transparent pl-2 pr-1.5 text-[13px] whitespace-nowrap text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) active:translate-y-px disabled:opacity-60",
        open && "bg-(--hover) text-(--fg)",
      )}
      title={notRunning ? `${title} is not running — launch it or pick a running model` : title}
      aria-label={`Model: ${title}${notRunning ? " (not running)" : ""}`}
      aria-expanded={open}
      aria-haspopup="menu"
    >
      <span className="max-w-[148px] truncate text-left">{label}</span>
      {notRunning ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)" /> : null}
      <ChevronDown className="pointer-events-none h-3.5 w-3.5 shrink-0 text-(--dim)" />
    </button>
  );
}

function ModelGroupOption({
  group,
  active,
  selected,
  onActivate,
}: {
  group: ModelGroup;
  active: boolean;
  selected: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(
        "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-(--fg) transition-colors hover:bg-(--hover) focus-visible:bg-(--hover) focus-visible:outline-none active:translate-y-px",
        active && "bg-(--hover)",
      )}
      onFocus={onActivate}
      onClick={onActivate}
    >
      <span className="min-w-0 flex-1 truncate">{group.name}</span>
      <span className="font-mono text-[length:var(--fs-2xs)] text-(--dim)">
        {group.models.length}
      </span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-(--dim)" /> : null}
      <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-(--dim)" />
    </button>
  );
}

function ModelOptions({
  models,
  selectedModel,
  onSelect,
}: {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
}) {
  return models.map((model) => (
    <ModelOption
      key={model.id}
      model={model}
      selected={model.id === selectedModel}
      onSelect={onSelect}
    />
  ));
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: AgentModel;
  selected: boolean;
  onSelect: (modelId: string) => void;
}) {
  const label = model.rawId || model.name;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={() => onSelect(model.id)}
      className={cx(
        "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md pl-2 pr-2 text-left text-[13px] text-(--fg) transition-colors hover:bg-(--hover) focus-visible:bg-(--hover) focus-visible:outline-none active:translate-y-px",
        selected && "bg-(--color-input)",
      )}
    >
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-(--fg)" /> : null}
    </button>
  );
}

function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  close();
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
