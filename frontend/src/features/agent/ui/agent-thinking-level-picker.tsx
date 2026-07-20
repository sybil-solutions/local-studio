"use client";

import { useCallback, useState, type MouseEvent, type PointerEvent } from "react";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "@/features/agent/contracts";
import { Brain, Check, ChevronDown } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

const LABELS: Record<AgentThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

export function AgentThinkingLevelPicker({
  value,
  levels,
  disabled,
  onSelect,
}: {
  value: AgentThinkingLevel;
  levels: readonly AgentThinkingLevel[];
  disabled: boolean;
  onSelect: (level: AgentThinkingLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const effectiveValue = levels.includes(value) ? value : (levels.at(-1) ?? "off");
  const unavailable = disabled || levels.length <= 1;
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
      <button
        type="button"
        onClick={() => {
          if (!unavailable) setOpen((current) => !current);
        }}
        disabled={unavailable}
        className={cx(
          "inline-flex h-[30px] min-w-0 items-center gap-1.5 rounded-lg px-2 text-[length:var(--fs-sm)] text-(--fg)/70 transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-45",
          open && "bg-(--hover) text-(--fg)",
        )}
        title={
          levels.length > 1
            ? `Reasoning level: ${LABELS[effectiveValue]}`
            : "This model uses a fixed reasoning level"
        }
        aria-label={`Reasoning level: ${LABELS[effectiveValue]}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
        <span className="max-w-16 truncate">{LABELS[effectiveValue]}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div
          className="absolute bottom-full right-0 z-30 mb-1.5 min-w-36 rounded-xl border border-(--color-popover-border) bg-(--color-popover) p-1.5 shadow-[0_16px_32px_-8px_rgba(0,0,0,0.35)]"
          role="menu"
          aria-label="Reasoning level"
        >
          {AGENT_THINKING_LEVELS.filter((level) => levels.includes(level)).map((level) => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={level === effectiveValue}
              onClick={() => {
                onSelect(level);
                close();
              }}
              className={cx(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[length:var(--fs-base)] text-(--fg) transition-colors hover:bg-(--hover)",
                level === effectiveValue && "bg-(--color-input)",
              )}
            >
              <span className="flex-1">{LABELS[level]}</span>
              {level === effectiveValue ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
