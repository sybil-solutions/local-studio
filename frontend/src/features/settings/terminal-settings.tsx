"use client";

import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Input, Slider } from "@/ui";
import {
  DEFAULT_TERMINAL_KEYBINDS,
  TERMINAL_ACTION_LABELS,
  TERMINAL_ACTIONS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  eventToKeybind,
  formatKeybind,
  resetTerminalFontSize,
  resetTerminalKeybind,
  resetTerminalKeybinds,
  saveTerminalFontSize,
  setTerminalKeybind,
  useTerminalFontSize,
  useTerminalKeybinds,
  type TerminalAction,
  type TerminalKeybinds,
} from "@/lib/terminal-keybinds";
import { QuickPanelSettings } from "./quick-panel-settings";
import { SettingsButton, SettingsGroup, SettingsNotice, SettingsRow } from "./settings-ui";

function Keycaps({ binding }: { binding: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {formatKeybind(binding).map((part, index) => (
        <kbd
          key={`${part}-${index}`}
          className="rounded-sm border border-(--ui-separator) bg-(--ui-hover)/60 px-1.5 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--ui-fg)"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

function conflictCounts(keybinds: TerminalKeybinds): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of TERMINAL_ACTIONS)
    counts[keybinds[action]] = (counts[keybinds[action]] ?? 0) + 1;
  return counts;
}

export function ShortcutsSettings() {
  return (
    <div>
      <QuickPanelSettings />
      <TerminalSettings />
    </div>
  );
}

function TerminalSettings() {
  const keybinds = useTerminalKeybinds();
  const fontSize = useTerminalFontSize();
  const [capturing, setCapturing] = useState<TerminalAction | null>(null);
  const counts = conflictCounts(keybinds);

  useMountSubscription(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        return;
      }
      const binding = eventToKeybind(event);
      if (!binding) return;
      setTerminalKeybind(capturing, binding);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  return (
    <div>
      <SettingsGroup
        title="Terminal key bindings"
        description="Hotkeys apply to the focused terminal. Duplicate combinations are flagged; the first match wins."
        actions={<SettingsButton onClick={resetTerminalKeybinds}>Reset all</SettingsButton>}
      >
        {TERMINAL_ACTIONS.map((action) => {
          const binding = keybinds[action];
          const isDefault = binding === DEFAULT_TERMINAL_KEYBINDS[action];
          const isConflict = counts[binding] > 1;
          return (
            <SettingsRow
              key={action}
              label={TERMINAL_ACTION_LABELS[action]}
              value={
                capturing === action ? (
                  <span className="text-[length:var(--fs-sm)] text-(--ui-accent)">
                    Press a combination… (Esc to cancel)
                  </span>
                ) : (
                  <Keycaps binding={binding} />
                )
              }
              status={
                isConflict ? (
                  <SettingsNotice tone="warning">Duplicate combo</SettingsNotice>
                ) : undefined
              }
              actions={
                <div className="flex items-center gap-1">
                  <SettingsButton
                    onClick={() => setCapturing((current) => (current === action ? null : action))}
                  >
                    {capturing === action ? "Cancel" : "Rebind"}
                  </SettingsButton>
                  {isDefault ? null : (
                    <SettingsButton onClick={() => resetTerminalKeybind(action)}>
                      Reset
                    </SettingsButton>
                  )}
                </div>
              }
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup
        title="Text size"
        description="Applies live to every open terminal — no reload needed."
        actions={<SettingsButton onClick={resetTerminalFontSize}>Reset</SettingsButton>}
      >
        <SettingsRow
          label="Font size"
          value={
            <span className="font-mono text-[length:var(--fs-sm)] text-(--fg)" style={{ fontSize }}>
              {fontSize}px — echo hello
            </span>
          }
          control={
            <div className="flex items-center gap-3">
              <Slider
                value={fontSize}
                min={TERMINAL_FONT_SIZE_MIN}
                max={TERMINAL_FONT_SIZE_MAX}
                onChange={saveTerminalFontSize}
                aria-label="Terminal font size"
                className="w-40"
              />
              <Input
                type="number"
                min={TERMINAL_FONT_SIZE_MIN}
                max={TERMINAL_FONT_SIZE_MAX}
                value={fontSize}
                aria-label="Terminal font size in pixels"
                onChange={(event) => saveTerminalFontSize(Number(event.target.value))}
                className="w-20"
              />
            </div>
          }
        />
      </SettingsGroup>
    </div>
  );
}
