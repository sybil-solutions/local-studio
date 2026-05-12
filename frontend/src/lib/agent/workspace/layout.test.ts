import { describe, expect, it } from "vitest";
import {
  collectLeaves,
  findLeaf,
  removeLeaf,
  replaceLeaf,
  setSplitRatio,
  splitLeaf,
  type Layout,
} from "./layout";

const twoPaneLayout: Layout = {
  kind: "split",
  direction: "vertical",
  ratio: 0.5,
  a: { kind: "leaf", paneId: "left" },
  b: { kind: "leaf", paneId: "right" },
};

describe("workspace layout", () => {
  it("finds and collects leaf panes in render order", () => {
    expect(findLeaf(twoPaneLayout, "left")).toBe(true);
    expect(findLeaf(twoPaneLayout, "missing")).toBe(false);
    expect(collectLeaves(twoPaneLayout)).toEqual(["left", "right"]);
  });

  it("replaces only the matching leaf", () => {
    const next = replaceLeaf(twoPaneLayout, "left", { kind: "leaf", paneId: "new-left" });
    expect(collectLeaves(next)).toEqual(["new-left", "right"]);
    expect(
      collectLeaves(replaceLeaf(twoPaneLayout, "missing", { kind: "leaf", paneId: "x" })),
    ).toEqual(["left", "right"]);
  });

  it("splits a leaf on the requested side", () => {
    const next = splitLeaf({ kind: "leaf", paneId: "root" }, "root", "new", "horizontal", "a");
    expect(next).toMatchObject({ kind: "split", direction: "horizontal", ratio: 0.5 });
    expect(collectLeaves(next)).toEqual(["new", "root"]);
  });

  it("removes leaves and collapses their parent split", () => {
    expect(removeLeaf(twoPaneLayout, "left")).toEqual({ kind: "leaf", paneId: "right" });
    expect(removeLeaf({ kind: "leaf", paneId: "only" }, "only")).toBeNull();
    expect(removeLeaf(twoPaneLayout, "missing")).toEqual(twoPaneLayout);
  });

  it("updates split ratios while clamping unsafe values", () => {
    expect(setSplitRatio(twoPaneLayout, [0], 0.95)).toMatchObject({ ratio: 0.85 });
    expect(setSplitRatio(twoPaneLayout, [0], 0.05)).toMatchObject({ ratio: 0.15 });
    expect(setSplitRatio(twoPaneLayout, [], 0.25)).toBe(twoPaneLayout);
  });
});
