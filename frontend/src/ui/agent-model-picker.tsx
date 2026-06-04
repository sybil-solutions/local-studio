"use client";

import { useMemo, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { getStoredBackendUrl } from "@/lib/backend-url";
import { loadSavedControllers } from "@/lib/controllers";
import type { AgentModel } from "@/lib/agent/workspace/types";
import { ChevronDownIcon } from "./icons";
import { cx } from "./utils";

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
  const [activeControllerKey, setActiveControllerKey] = useState<string | null>(null);
  const controllerLabel = useActiveControllerLabel();
  const active = models.find((model) => model.id === selectedModel) ?? null;
  const groups = useMemo(() => groupModelsByController(models), [models]);
  const currentKey =
    activeControllerKey ?? (active ? controllerGroupKey(active) : null) ?? groups[0]?.key ?? null;
  const currentGroup = groups.find((group) => group.key === currentKey) ?? groups[0] ?? null;
  const disabled = loading || models.length === 0;
  const triggerLabel = modelTriggerLabel(active, selectedModel, loading, models.length);

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setOpen(false);
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <button
        type="button"
        onPointerDown={stopToolbarEvent}
        onMouseDown={stopToolbarEvent}
        onClick={() => {
          if (!disabled) setOpen((value) => !value);
        }}
        disabled={disabled}
        className="inline-flex !h-auto !min-h-0 !min-w-0 max-w-[160px] items-center gap-1 rounded-sm bg-transparent px-1 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg) disabled:opacity-60"
        title={active?.name || triggerLabel}
      >
        <span className="min-w-0 max-w-[132px] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="h-2.5 w-2.5 shrink-0" />
      </button>
      {open ? (
        <div
          className="absolute bottom-full right-0 z-[80] mb-1 w-80 overflow-hidden rounded-md border border-(--border) bg-[#151515] shadow-[0_12px_36px_rgba(0,0,0,0.65)]"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
        >
          <ControllerTabs
            groups={groups}
            currentKey={currentKey}
            controllerLabel={controllerLabel}
            onSelect={setActiveControllerKey}
          />
          <div className="max-h-72 overflow-y-auto p-1.5">
            {(currentGroup?.models ?? []).map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                selected={model.id === selectedModel}
                onSelect={(modelId) => {
                  onSelect(modelId);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ControllerTabs({
  groups,
  currentKey,
  controllerLabel,
  onSelect,
}: {
  groups: ModelGroup[];
  currentKey: string | null;
  controllerLabel: string | null;
  onSelect: (key: string) => void;
}) {
  if (groups.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-(--border) p-1.5">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          onClick={() => onSelect(group.key)}
          className={cx(
            "shrink-0 rounded px-2 py-1 font-mono text-[length:var(--fs-xs)]",
            group.key === currentKey
              ? "bg-(--hover) text-(--fg)"
              : "text-(--dim) hover:text-(--fg)",
          )}
        >
          {group.name || controllerLabel || "local"}
        </button>
      ))}
    </div>
  );
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
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className={cx(
        "flex w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left hover:bg-(--hover)",
        selected ? "bg-(--hover)" : "",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          selected ? "bg-(--accent)" : "bg-(--dim)/35",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-(--fg)">{model.rawId || model.name}</span>
        <span className="mt-0.5 block truncate font-mono text-[length:var(--fs-xs)] text-(--dim)">
          {formatCompactNumber(model.contextWindow)} context{model.reasoning ? " · reasoning" : ""}
        </span>
      </span>
    </button>
  );
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

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function subscribeToControllerStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function computeActiveControllerLabel(): string | null {
  const url = getStoredBackendUrl();
  if (!url) return null;
  const saved = loadSavedControllers();
  if (saved.length === 0) return null;
  const match = saved.find((entry) => entry.url === url);
  return match?.name?.trim() || shortHost(url);
}

function useActiveControllerLabel(): string | null {
  return useSyncExternalStore(
    subscribeToControllerStorage,
    computeActiveControllerLabel,
    () => null,
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
