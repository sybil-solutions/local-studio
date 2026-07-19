"use client";

import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";

/**
 * Live surface for the agent browser pane: renders the server-side headless
 * Chromium (features/agent/browser-host) as a CDP screencast and forwards
 * pointer/keyboard/wheel input back to it. The user and the agent are looking
 * at — and driving — the same browser.
 *
 * Transport: polls /api/agent/browser/frame (~10fps) for the latest JPEG +
 * nav state — Next's standalone server buffers locally-built SSE streams, and
 * polling also survives a buffering proxy / Cloudflare for remote deploys.
 * Input POSTs to /api/agent/browser/input, viewport sync to .../viewport.
 */

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type BrowserPaneState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

type FramePayload = {
  ok: boolean;
  error?: string;
  data?: { frame: string | null } & BrowserPaneState;
};

type Props = {
  /** Desired URL from the address bar; navigated server-side when it diverges. */
  url: string;
  onState: (state: BrowserPaneState) => void;
  /** Called once when the host reports no Chromium — the pane should fall back to reading mode. */
  onUnavailable: (error: string) => void;
  /** Frame polling pauses entirely while the surface is hidden. */
  visible?: boolean;
};

const VIEWPORT_MIN = { width: 320, height: 240 };
const VIEWPORT_MAX = { width: 1920, height: 1200 };
const POLL_INTERVAL_MS = 110; // ~9fps
const MOVE_THROTTLE_MS = 33;

function postBrowser(path: string, body: unknown): void {
  void fetch(`/api/agent/browser/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function ScreencastSurface({ url, onState, onUnavailable, visible = true }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const serverUrlRef = useRef<string>("");
  const viewportRef = useRef({ width: 1280, height: 800 });
  const lastMoveAtRef = useRef(0);
  const onStateRef = useRef(onState);
  const onUnavailableRef = useRef(onUnavailable);

  // Mirror the latest callbacks into refs in the commit phase (never during
  // render), so the long-lived poll loop always calls the current handlers
  // without restarting.
  useMountSubscription(() => {
    onStateRef.current = onState;
    onUnavailableRef.current = onUnavailable;
  }, [onState, onUnavailable]);

  // ── Frame poll loop: sequential (no overlap), backs off on transient error,
  // surfaces 503 once as unavailable. Pauses while the pane is hidden (panel
  // collapsed) and idles at 1s while the document itself is hidden, so a
  // background browser tab doesn't burn ~9 fetches+JPEG decodes per second. ──
  useMountSubscription(() => {
    if (!visible) return;
    let disposed = false;
    let timer: EffectTimer | null = null;

    const tick = async () => {
      if (disposed) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = effectTimeout(() => void tick(), 1_000);
        return;
      }
      try {
        const response = await fetch("/api/agent/browser/frame", { cache: "no-store" });
        if (response.status === 503) {
          const payload = (await response.json().catch(() => null)) as FramePayload | null;
          onUnavailableRef.current(payload?.error || "Browser unavailable");
          return; // stop polling; pane switches to reading mode
        }
        const payload = (await response.json()) as FramePayload;
        if (!disposed && payload.ok && payload.data) {
          if (payload.data.frame) setFrameSrc(`data:image/jpeg;base64,${payload.data.frame}`);
          serverUrlRef.current = payload.data.url;
          onStateRef.current({
            url: payload.data.url,
            title: payload.data.title,
            canGoBack: payload.data.canGoBack,
            canGoForward: payload.data.canGoForward,
          });
        }
      } catch {
        // transient — keep polling
      }
      if (!disposed) timer = effectTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      disposed = true;
      if (timer) timer.cancel();
    };
  }, [visible]);

  // ── Address-bar navigation: navigate server-side when the desired URL
  // diverges from what the host last reported ────────────────────────────
  useMountSubscription(() => {
    const target = url.trim();
    if (!target || target === serverUrlRef.current) return;
    let cancelled = false;
    void fetch("/api/agent/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { ok: boolean; error?: string };
        if (cancelled) return;
        setNavError(payload.ok ? null : (payload.error ?? "Navigation failed"));
      })
      .catch((error) => {
        if (!cancelled) {
          setNavError(error instanceof Error ? error.message : "Navigation failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

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
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * viewportRef.current.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * viewportRef.current.height),
    };
  };

  const buttonName = (button: number) =>
    button === 1 ? "middle" : button === 2 ? "right" : "left";

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    container?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = toViewport(event);
    postBrowser("input", {
      kind: "mouse",
      type: "down",
      x,
      y,
      button: buttonName(event.button),
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
      button: buttonName(event.button),
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
    // Leave app-level shortcuts (⌘K etc.) alone; forward everything else.
    if (event.metaKey) return;
    event.preventDefault();
    postBrowser("input", { kind: "key", type, key: event.key, code: event.code });
    if (type === "down" && event.key.length === 1 && !event.ctrlKey && !event.altKey) {
      postBrowser("input", {
        kind: "key",
        type: "char",
        key: event.key,
        code: event.code,
        text: event.key,
      });
    }
    if (type === "down" && event.key === "Enter") {
      postBrowser("input", { kind: "key", type: "char", key: "Enter", code: "Enter", text: "\r" });
    }
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
      {frameSrc ? (
        <img
          src={frameSrc}
          alt=""
          draggable={false}
          className="size-full select-none object-contain"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-(--bg) text-xs text-(--dim)">
          Connecting to browser…
        </div>
      )}
      {navError ? (
        <div className="absolute left-2 top-2 max-w-[80%] truncate rounded-md border border-(--err)/40 bg-(--bg)/95 px-2 py-1 text-xs text-(--err)">
          {navError}
        </div>
      ) : null}
    </div>
  );
}
