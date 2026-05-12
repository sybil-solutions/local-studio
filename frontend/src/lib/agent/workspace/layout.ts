// Pane layout tree for the agent surface. A leaf is a single chat pane that
// can host one or more tabs (each tab is a separate pi session). A split is
// two children — left/right (vertical split) or top/bottom (horizontal split)
// — sharing a draggable ratio.

export type PaneId = string;

export type LayoutLeaf = { kind: "leaf"; paneId: PaneId };

export type LayoutSplit = {
  kind: "split";
  // "vertical"   = side-by-side (a vertical separator between left/right)
  // "horizontal" = stacked (a horizontal separator between top/bottom)
  direction: "vertical" | "horizontal";
  ratio: number;
  a: Layout;
  b: Layout;
};

export type Layout = LayoutLeaf | LayoutSplit;

export function findLeaf(layout: Layout, paneId: PaneId): boolean {
  if (layout.kind === "leaf") return layout.paneId === paneId;
  return findLeaf(layout.a, paneId) || findLeaf(layout.b, paneId);
}

export function collectLeaves(layout: Layout): PaneId[] {
  if (layout.kind === "leaf") return [layout.paneId];
  return [...collectLeaves(layout.a), ...collectLeaves(layout.b)];
}

// Replace one leaf with a new layout subtree. Used when splitting.
export function replaceLeaf(layout: Layout, paneId: PaneId, replacement: Layout): Layout {
  if (layout.kind === "leaf") {
    return layout.paneId === paneId ? replacement : layout;
  }
  return {
    ...layout,
    a: replaceLeaf(layout.a, paneId, replacement),
    b: replaceLeaf(layout.b, paneId, replacement),
  };
}

// Remove a leaf and collapse its parent split — the surviving sibling
// replaces the parent split entirely.
export function removeLeaf(layout: Layout, paneId: PaneId): Layout | null {
  if (layout.kind === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }
  const a = removeLeaf(layout.a, paneId);
  const b = removeLeaf(layout.b, paneId);
  if (a === null && b === null) return null;
  if (a === null) return b!;
  if (b === null) return a!;
  return { ...layout, a, b };
}

// Split a leaf along an edge. side === "a" puts the new pane on the
// top/left; side === "b" on the bottom/right.
export function splitLeaf(
  layout: Layout,
  paneId: PaneId,
  newPaneId: PaneId,
  direction: "vertical" | "horizontal",
  side: "a" | "b",
): Layout {
  return replaceLeaf(layout, paneId, {
    kind: "split",
    direction,
    ratio: 0.5,
    a: side === "a" ? { kind: "leaf", paneId: newPaneId } : { kind: "leaf", paneId },
    b: side === "a" ? { kind: "leaf", paneId } : { kind: "leaf", paneId: newPaneId },
  });
}

// Update the ratio of a split given a delta in pixels along its drag axis.
export function setSplitRatio(layout: Layout, splitPath: number[], ratio: number): Layout {
  if (splitPath.length === 0 || layout.kind !== "split") return layout;
  const [head, ...rest] = splitPath;
  const clamped = Math.min(0.85, Math.max(0.15, ratio));
  if (rest.length === 0) {
    return { ...layout, ratio: clamped };
  }
  return head === 0
    ? { ...layout, a: setSplitRatio(layout.a, rest, ratio) }
    : { ...layout, b: setSplitRatio(layout.b, rest, ratio) };
}
