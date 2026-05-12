import { describe, expect, it } from "vitest";
import { getModelColor } from "./colors";

describe("model colors", () => {
  it("assigns stable palette colors by model name", () => {
    expect(getModelColor("Qwen/Qwen3-32B")).toBe(getModelColor("Qwen/Qwen3-32B"));
    expect(getModelColor("Qwen/Qwen3-32B")).toMatch(/^hsl\(/);
    expect(new Set(["a", "b", "c"].map(getModelColor)).size).toBeGreaterThan(1);
  });
});
