"use client";

import { ReactNode, useState, useSyncExternalStore } from "react";
import type { Layout, PaneId } from "@/features/agent/workspace/layout";

type RenderPane = (paneId: PaneId) => ReactNode;

type Props = {
  layout: Layout;
  renderPane: RenderPane;
  onSplit: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
  onOpenTab: (paneId: PaneId, payload: SessionDropPayload) => void;
  onResize: (path: number[], ratio: number) => void;
};

export type SessionDropPayload = {
  piSessionId?: string | null;
  projectId?: string;
  cwd?: string;
  paneId?: string;
  tabId?: string;
  title?: string;
};

function readSessionDrop(event: React.DragEvent): SessionDropPayload | null {
  const raw = event.dataTransfer.getData("application/x-vllm-agent-session");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as SessionDropPayload;
      if (parsed.piSessionId || parsed.tabId) return parsed;
    } catch {}
  }
  const piSessionId = event.dataTransfer.getData("application/x-vllm-session");
  return piSessionId ? { piSessionId } : null;
}

export function PaneGrid({ layout, renderPane, onSplit, onOpenTab, onResize }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full">
      <PaneNode
        layout={layout}
        path={[]}
        renderPane={renderPane}
        onSplit={onSplit}
        onOpenTab={onOpenTab}
        onResize={onResize}
      />
    </div>
  );
}

function PaneNode({
  layout,
  path,
  renderPane,
  onSplit,
  onOpenTab,
  onResize,
}: {
  layout: Layout;
  path: number[];
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
  onOpenTab: Props["onOpenTab"];
  onResize: Props["onResize"];
}) {
  if (layout.kind === "leaf") {
    return (
      <PaneLeaf
        paneId={layout.paneId}
        renderPane={renderPane}
        onSplit={onSplit}
        onOpenTab={onOpenTab}
      />
    );
  }
  return (
    <SplitNode
      layout={layout}
      path={path}
      renderPane={renderPane}
      onSplit={onSplit}
      onOpenTab={onOpenTab}
      onResize={onResize}
    />
  );
}

function SplitNode({
  layout,
  path,
  renderPane,
  onSplit,
  onOpenTab,
  onResize,
}: {
  layout: Extract<Layout, { kind: "split" }>;
  path: number[];
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
  onOpenTab: Props["onOpenTab"];
  onResize: Props["onResize"];
}) {
  const isRow = layout.direction === "vertical";
  const aPct = `${Math.round(layout.ratio * 100)}%`;
  const bPct = `${Math.round((1 - layout.ratio) * 100)}%`;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const splitter = event.currentTarget.parentElement as HTMLElement;
    const rect = splitter.getBoundingClientRect();
    const startCoord = isRow ? rect.left : rect.top;
    const span = isRow ? rect.width : rect.height;
    const onMove = (e: PointerEvent) => {
      const coord = isRow ? e.clientX : e.clientY;
      const ratio = (coord - startCoord) / span;
      onResize(path, ratio);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`flex h-full min-h-0 min-w-0 flex-1 ${isRow ? "flex-row" : "flex-col"}`}>
      <div className="flex min-h-0 min-w-0" style={isRow ? { width: aPct } : { height: aPct }}>
        <PaneNode
          layout={layout.a}
          path={[...path, 0]}
          renderPane={renderPane}
          onSplit={onSplit}
          onOpenTab={onOpenTab}
          onResize={onResize}
        />
      </div>
      <div
        role="separator"
        aria-orientation={isRow ? "vertical" : "horizontal"}
        onPointerDown={handlePointerDown}
        className={`shrink-0 border-(--border) bg-(--color-header) hover:bg-(--hover) ${
          isRow ? "h-full w-1 cursor-col-resize border-x" : "w-full h-1 cursor-row-resize border-y"
        }`}
        title="Drag to resize"
      />
      <div className="flex min-h-0 min-w-0" style={isRow ? { width: bPct } : { height: bPct }}>
        <PaneNode
          layout={layout.b}
          path={[...path, 1]}
          renderPane={renderPane}
          onSplit={onSplit}
          onOpenTab={onOpenTab}
          onResize={onResize}
        />
      </div>
    </div>
  );
}

function PaneLeaf({
  paneId,
  renderPane,
  onSplit,
  onOpenTab,
}: {
  paneId: PaneId;
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
  onOpenTab: Props["onOpenTab"];
}) {
  const [hoverEdge, setHoverEdge] = useState<null | "center" | "left" | "right" | "top" | "bottom">(
    null,
  );
  const dragActive = useSessionDragActive();

  const onDragOver =
    (edge: "center" | "left" | "right" | "top" | "bottom") =>
    (event: React.DragEvent<HTMLDivElement>) => {
      const hasSession =
        event.dataTransfer.types.includes("application/x-vllm-session") ||
        event.dataTransfer.types.includes("application/x-vllm-agent-session");
      if (!hasSession) return;
      event.preventDefault();
      if (edge !== "center") event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setHoverEdge(edge);
    };

  const onDrop =
    (direction: "vertical" | "horizontal", side: "a" | "b") =>
    (event: React.DragEvent<HTMLDivElement>) => {
      const payload = readSessionDrop(event);
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      setHoverEdge(null);
      onSplit(paneId, direction, side, payload);
    };

  const onCenterDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const payload = readSessionDrop(event);
    if (!payload) return;
    event.preventDefault();
    setHoverEdge(null);
    onOpenTab(paneId, payload);
  };

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1"
      onDragOver={onDragOver("center")}
      onDragLeave={() => setHoverEdge(null)}
      onDrop={onCenterDrop}
    >
      {renderPane(paneId)}

      {/* Edge drop targets: thin strips along each edge that catch a session
          row being dragged. They are only mounted while a session drag is in
          progress so they don't steal clicks from the chat-pane header
          (e.g. the "..." menu or the right sidebar toggle). */}
      {dragActive ? (
        <>
          <div
            onDragOver={onDragOver("left")}
            onDragLeave={() => setHoverEdge((e) => (e === "left" ? null : e))}
            onDrop={onDrop("vertical", "a")}
            className="absolute inset-y-0 left-0 z-10 w-6"
          />
          <div
            onDragOver={onDragOver("right")}
            onDragLeave={() => setHoverEdge((e) => (e === "right" ? null : e))}
            onDrop={onDrop("vertical", "b")}
            className="absolute inset-y-0 right-0 z-10 w-6"
          />
          <div
            onDragOver={onDragOver("top")}
            onDragLeave={() => setHoverEdge((e) => (e === "top" ? null : e))}
            onDrop={onDrop("horizontal", "a")}
            className="absolute inset-x-0 top-0 z-10 h-6"
          />
          <div
            onDragOver={onDragOver("bottom")}
            onDragLeave={() => setHoverEdge((e) => (e === "bottom" ? null : e))}
            onDrop={onDrop("horizontal", "b")}
            className="absolute inset-x-0 bottom-0 z-10 h-6"
          />
        </>
      ) : null}

      {hoverEdge ? (
        <div
          aria-hidden
          className={`pointer-events-none absolute z-20 bg-(--fg)/10 ring-1 ring-(--fg)/35 ${
            hoverEdge === "left"
              ? "inset-y-0 left-0 w-1/2"
              : hoverEdge === "right"
                ? "inset-y-0 right-0 w-1/2"
                : hoverEdge === "top"
                  ? "inset-x-0 top-0 h-1/2"
                  : hoverEdge === "bottom"
                    ? "inset-x-0 bottom-0 h-1/2"
                    : "inset-6 rounded"
          }`}
        />
      ) : null}
    </div>
  );
}

let sessionDragActiveSnapshot = false;
const sessionDragActiveListeners = new Set<() => void>();

const notifySessionDragActiveListeners = (): void => {
  for (const listener of sessionDragActiveListeners) {
    listener();
  }
};

const setSessionDragActiveSnapshot = (active: boolean): void => {
  if (sessionDragActiveSnapshot === active) return;
  sessionDragActiveSnapshot = active;
  notifySessionDragActiveListeners();
};

const getSessionDragActiveSnapshot = (): boolean => sessionDragActiveSnapshot;

const subscribeSessionDragActive = (listener: () => void): (() => void) => {
  sessionDragActiveListeners.add(listener);
  if (typeof document === "undefined") {
    return () => sessionDragActiveListeners.delete(listener);
  }

  const onDragStart = (event: DragEvent) => {
    const types = event.dataTransfer?.types;
    if (!types) return;
    const hasSession = Array.from(types).some(
      (type) =>
        type === "application/x-vllm-session" || type === "application/x-vllm-agent-session",
    );
    if (hasSession) setSessionDragActiveSnapshot(true);
  };
  const stop = () => setSessionDragActiveSnapshot(false);
  document.addEventListener("dragstart", onDragStart);
  document.addEventListener("dragend", stop);
  document.addEventListener("drop", stop);
  return () => {
    sessionDragActiveListeners.delete(listener);
    document.removeEventListener("dragstart", onDragStart);
    document.removeEventListener("dragend", stop);
    document.removeEventListener("drop", stop);
  };
};

/**
 * Tracks whether a session row is currently being dragged anywhere in the
 * document. The pane grid uses this to gate its invisible edge drop targets so
 * they don't steal clicks from the chat-pane header (e.g. the "..." menu and
 * the right sidebar toggle, both of which sit underneath the top strip).
 */
function useSessionDragActive(): boolean {
  return useSyncExternalStore(
    subscribeSessionDragActive,
    getSessionDragActiveSnapshot,
    getSessionDragActiveSnapshot,
  );
}
