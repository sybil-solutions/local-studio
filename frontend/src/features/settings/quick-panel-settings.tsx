"use client";

import { useState } from "react";
import {
  getQuickPanelBridge,
  type QuickPanelHotkeyState,
} from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton, SettingsGroup, SettingsNotice, SettingsRow } from "./settings-ui";

const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
]);

const CODE_TO_KEY: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Tab: "Tab",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

/** Map a keydown to an Electron accelerator, or null if it isn't a usable
 * combo (needs at least one modifier plus a non-modifier key). */
function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push(isMac() ? "Command" : "Super");
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;

  let key: string | null = null;
  const { code } = event;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = CODE_TO_KEY[code] ?? null;
  if (!key) return null;

  return [...modifiers, key].join("+");
}

const MAC_KEY_GLYPHS: Record<string, string> = {
  Command: "⌘",
  CommandOrControl: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

const GENERIC_KEY_LABELS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  Control: "Ctrl",
  Super: "Win",
};

function hotkeyParts(accelerator: string): string[] {
  const mac = isMac();
  return accelerator
    .split("+")
    .filter(Boolean)
    .map((part) => (mac ? (MAC_KEY_GLYPHS[part] ?? part) : (GENERIC_KEY_LABELS[part] ?? part)));
}

function HotkeyKeys({ accelerator }: { accelerator: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {hotkeyParts(accelerator).map((part, index) => (
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

export function QuickPanelSettings() {
  const [state, setState] = useState<QuickPanelHotkeyState | null>(null);
  const [bridgeAvailable, setBridgeAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useMountSubscription(() => {
    let cancelled = false;
    const bridge = getQuickPanelBridge();
    if (!bridge?.getHotkey) {
      setBridgeAvailable(false);
      return;
    }
    setBridgeAvailable(true);
    void bridge
      .getHotkey()
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch(() => {
        if (!cancelled) setBridgeAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useMountSubscription(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      setRecording(false);
      const bridge = getQuickPanelBridge();
      if (!bridge?.setHotkey) return;
      void bridge.setHotkey(accelerator).then((result) => {
        if (result.ok) {
          setState((prev) => (prev ? { ...prev, hotkey: result.hotkey } : prev));
          setError(null);
          setSaved(true);
        } else {
          setError(result.error ?? "Could not register that hotkey");
        }
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  useMountSubscription(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const resetToDefault = () => {
    const bridge = getQuickPanelBridge();
    if (!bridge?.setHotkey || !state) return;
    void bridge.setHotkey(state.defaultHotkey).then((result) => {
      if (result.ok) {
        setState((prev) => (prev ? { ...prev, hotkey: result.hotkey } : prev));
        setError(null);
        setSaved(true);
      } else {
        setError(result.error ?? "Could not reset the hotkey");
      }
    });
  };

  return (
    <SettingsGroup
      title="Quick panel shortcut"
      description="Choose the global hotkey that toggles the floating chat panel."
    >
      {bridgeAvailable === false ? (
        <div className="px-3 py-2">
          <SettingsNotice tone="default">
            The quick panel is part of the Local Studio desktop app. Open Settings there to
            configure its hotkey.
          </SettingsNotice>
        </div>
      ) : (
        <>
          <SettingsRow
            label="Global hotkey"
            description="Press the hotkey anywhere to toggle the floating chat panel. The panel remembers its size when you resize it."
            value={
              recording ? (
                <span className="text-[length:var(--fs-sm)] text-(--ui-accent)">
                  Press a key combination… (Esc to cancel)
                </span>
              ) : state ? (
                <HotkeyKeys accelerator={state.hotkey} />
              ) : (
                <span className="text-(--ui-muted)">Loading…</span>
              )
            }
            actions={
              <div className="flex items-center gap-1">
                {saved ? (
                  <span className="px-1 text-[length:var(--fs-xs)] text-(--ui-success)">Saved</span>
                ) : null}
                <SettingsButton onClick={() => setRecording((value) => !value)} disabled={!state}>
                  {recording ? "Cancel" : "Change"}
                </SettingsButton>
                {state && state.hotkey !== state.defaultHotkey ? (
                  <SettingsButton onClick={resetToDefault}>Reset</SettingsButton>
                ) : null}
              </div>
            }
          />
          {error ? (
            <div className="px-3 py-2">
              <SettingsNotice tone="danger">{error}</SettingsNotice>
            </div>
          ) : null}
        </>
      )}
    </SettingsGroup>
  );
}
