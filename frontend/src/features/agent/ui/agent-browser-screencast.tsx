"use client";

import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  browserKeyInputs,
  browserMouseButton,
  browserViewportPoint,
} from "@/features/agent/ui/agent-browser-input";
import { useBrowserLiveFrame } from "@/features/agent/ui/agent-browser-live-store";

type Props = {
  navigationError: string | null;
};

const VIEWPORT_MIN = { width: 320, height: 240 };
const VIEWPORT_MAX = { width: 1920, height: 1200 };
const MOVE_THROTTLE_MS = 33;

function postBrowser(path: string, body: unknown): void {
  void fetch(`/api/agent/browser/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function ScreencastSurface({ navigationError }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { frame } = useBrowserLiveFrame();
  const viewportRef = useRef({ width: 1280, height: 800 });
  const lastMoveAtRef = useRef(0);
  // ── Viewport sync: match the headless viewport to the pane size ────────
  useMountSubscription(() => {
    if (!container) return;
    let timer: EffectTimer | null = null;
    const sync = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.round(
        Math.min(VIEWPORT_MAX.width, Math.max(VIEWPORT_MIN.width, rect.width)),
      );
      const height = Math.round(
        Math.min(VIEWPORT_MAX.height, Math.max(VIEWPORT_MIN.height, rect.height)),
      );
      if (width === viewportRef.current.width && height === viewportRef.current.height) return;
      viewportRef.current = { width, height };
      postBrowser("viewport", { width, height });
    };
    const observer = new ResizeObserver(() => {
      if (timer) timer.cancel();
      timer = effectTimeout(sync, 250);
    });
    observer.observe(container);
    sync();
    return () => {
      if (timer) timer.cancel();
      observer.disconnect();
    };
  }, [container]);

  // ── Input forwarding ────────────────────────────────────────────────────
  const toViewport = (event: { clientX: number; clientY: number }) => {
    const rect = container?.getBoundingClientRect();
    return browserViewportPoint(rect ?? null, viewportRef.current, event);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    container?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = toViewport(event);
    postBrowser("input", {
      kind: "mouse",
      type: "down",
      x,
      y,
      button: browserMouseButton(event.button),
      clickCount: Math.max(1, event.detail),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = toViewport(event);
    postBrowser("input", {
      kind: "mouse",
      type: "up",
      x,
      y,
      button: browserMouseButton(event.button),
      clickCount: Math.max(1, event.detail),
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return;
    lastMoveAtRef.current = now;
    const { x, y } = toViewport(event);
    postBrowser("input", { kind: "mouse", type: "move", x, y });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const { x, y } = toViewport(event);
    postBrowser("input", { kind: "wheel", x, y, deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const handleKey = (type: "down" | "up") => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const inputs = browserKeyInputs(type, event);
    if (inputs.length === 0) return;
    event.preventDefault();
    for (const input of inputs) postBrowser("input", input);
  };

  return (
    <div
      ref={setContainer}
      tabIndex={0}
      role="application"
      aria-label="Live browser"
      className="relative size-full min-h-0 overflow-hidden bg-white outline-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      onKeyDown={handleKey("down")}
      onKeyUp={handleKey("up")}
      onContextMenu={(event) => event.preventDefault()}
    >
      {frame ? (
        <img
          src={`data:image/jpeg;base64,${frame}`}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-(--bg) text-xs text-(--dim)">
          Connecting to browser…
        </div>
      )}
      {navigationError ? (
        <div className="absolute left-2 top-2 max-w-[80%] truncate rounded-md border border-(--err)/40 bg-(--bg)/95 px-2 py-1 text-xs text-(--err)">
          {navigationError}
        </div>
      ) : null}
    </div>
  );
}
