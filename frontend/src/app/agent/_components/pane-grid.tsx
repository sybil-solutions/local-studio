"use client";

import { ReactNode, useState } from "react";
import type { Layout, PaneId } from "./pane-layout";

type RenderPane = (paneId: PaneId) => ReactNode;

type Props = {
  layout: Layout;
  renderPane: RenderPane;
  onSplit: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: { piSessionId?: string },
  ) => void;
  onResize: (path: number[], ratio: number) => void;
};

export function PaneGrid({ layout, renderPane, onSplit, onResize }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full">
      <PaneNode
        layout={layout}
        path={[]}
        renderPane={renderPane}
        onSplit={onSplit}
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
  onResize,
}: {
  layout: Layout;
  path: number[];
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
  onResize: Props["onResize"];
}) {
  if (layout.kind === "leaf") {
    return (
      <PaneLeaf paneId={layout.paneId} renderPane={renderPane} onSplit={onSplit} />
    );
  }
  return (
    <SplitNode
      layout={layout}
      path={path}
      renderPane={renderPane}
      onSplit={onSplit}
      onResize={onResize}
    />
  );
}

function SplitNode({
  layout,
  path,
  renderPane,
  onSplit,
  onResize,
}: {
  layout: Extract<Layout, { kind: "split" }>;
  path: number[];
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
  onResize: Props["onResize"];
}) {
  const isRow = layout.direction === "vertical"; // side-by-side = horizontal flex
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
          onResize={onResize}
        />
      </div>
      <div
        role="separator"
        aria-orientation={isRow ? "vertical" : "horizontal"}
        onPointerDown={handlePointerDown}
        className={`shrink-0 border-(--border) bg-(--bg) hover:bg-(--surface) ${
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
          onResize={onResize}
        />
      </div>
    </div>
  );
}

// A leaf renders a chat pane plus four invisible edge drop targets that turn
// into a visible drop zone overlay while a session row is being dragged.
function PaneLeaf({
  paneId,
  renderPane,
  onSplit,
}: {
  paneId: PaneId;
  renderPane: RenderPane;
  onSplit: Props["onSplit"];
}) {
  const [hoverEdge, setHoverEdge] = useState<null | "left" | "right" | "top" | "bottom">(null);

  const onDragOver = (edge: "left" | "right" | "top" | "bottom") =>
    (event: React.DragEvent<HTMLDivElement>) => {
      const sessionId = event.dataTransfer.types.includes("application/x-vllm-session");
      if (!sessionId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setHoverEdge(edge);
    };

  const onDrop = (
    direction: "vertical" | "horizontal",
    side: "a" | "b",
  ) => (event: React.DragEvent<HTMLDivElement>) => {
    const piSessionId = event.dataTransfer.getData("application/x-vllm-session");
    if (!piSessionId) return;
    event.preventDefault();
    setHoverEdge(null);
    onSplit(paneId, direction, side, { piSessionId });
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {renderPane(paneId)}

      {/* Edge drop targets: thin strips along each edge that catch a session
          row being dragged. The visible highlight only appears while
          something is being dragged over us. */}
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

      {hoverEdge ? (
        <div
          aria-hidden
          className={`pointer-events-none absolute z-20 bg-(--accent)/15 ring-1 ring-(--accent) ${
            hoverEdge === "left"
              ? "inset-y-0 left-0 w-1/2"
              : hoverEdge === "right"
                ? "inset-y-0 right-0 w-1/2"
                : hoverEdge === "top"
                  ? "inset-x-0 top-0 h-1/2"
                  : "inset-x-0 bottom-0 h-1/2"
          }`}
        />
      ) : null}
    </div>
  );
}
