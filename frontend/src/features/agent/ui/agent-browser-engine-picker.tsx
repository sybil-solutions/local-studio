"use client";

import { useCallback, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

// Which browser binary the embedded backend drives. This exists because the
// choice is otherwise unreachable: a packaged desktop app inherits no shell
// environment, so LOCAL_STUDIO_CHROME_PATH can only be set by someone who
// launches the app from a terminal. Auto-detection will also essentially never
// land on Brave — Playwright's bundled Chromium is found first — so "use Brave"
// has to be something a user can say out loud.

type EngineInfo = { id: string; label: string; path: string | null };

type EnginesPayload = {
  preference: string;
  preferenceUnavailable: boolean;
  override: string | null;
  active: { id: string; label: string; path: string; source: string } | null;
  unavailableReason: string | null;
  engines: EngineInfo[];
};

type EnginesResponse = { ok?: boolean; data?: EnginesPayload; error?: string };

export function BrowserEnginePicker({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<EnginesPayload | null>(null);
  const [busy, setBusy] = useState(false);

  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetch("/api/agent/browser/engines", { cache: "no-store" })
      .then(async (response) => (await response.json()) as EnginesResponse)
      .then((body) => {
        if (!cancelled && body.ok && body.data) setState(body.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const choose = useCallback((engine: string) => {
    setBusy(true);
    void fetch("/api/agent/browser/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine }),
    })
      .then(async (response) => (await response.json()) as EnginesResponse)
      .then((body) => {
        if (body.ok && body.data) setState(body.data);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  }, []);

  if (!state) return null;

  const overridden = Boolean(state.override);
  const activeLabel = state.active?.label ?? "unavailable";
  const title = overridden
    ? `Engine forced by LOCAL_STUDIO_CHROME_PATH: ${state.override}`
    : state.preferenceUnavailable
      ? `Selected engine is not installed — running ${activeLabel}`
      : `Browser engine: ${activeLabel}. Headless, with a throwaway profile — not your signed-in browser.`;

  return (
    <select
      value={state.preference}
      disabled={overridden || busy}
      onChange={(event) => choose(event.target.value)}
      title={title}
      aria-label="Browser engine"
      // Fixed narrow width on purpose: a native select sizes itself to its
      // WIDEST option, and "Google Chrome (not installed)" would shove the
      // reader toggle and close button out of a 280px-wide panel. The popup
      // still renders full labels, and the tooltip carries the active one.
      className={`h-7 w-20 shrink-0 truncate rounded border bg-(--surface) px-1 text-[length:var(--fs-xs)] outline-none disabled:opacity-40 ${
        state.preferenceUnavailable
          ? "border-(--err)/50 text-(--err)"
          : "border-(--border) text-(--dim) hover:text-(--fg)"
      }`}
    >
      {state.engines.map((engine) => (
        <option key={engine.id} value={engine.id} disabled={!engine.path}>
          {engine.path ? engine.label : `${engine.label} (not installed)`}
        </option>
      ))}
    </select>
  );
}
