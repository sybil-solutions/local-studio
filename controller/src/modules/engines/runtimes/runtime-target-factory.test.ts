import { describe, expect, test } from "bun:test";
import { makeRuntimeTarget } from "./runtime-target-factory";

describe("runtime update capabilities", () => {
  test("does not update a system vLLM Python", () => {
    const target = makeRuntimeTarget({
      backend: "vllm",
      kind: "system",
      source: "discovered",
      key: "/opt/homebrew/bin/python3",
      label: "Homebrew Python",
      installed: true,
      pythonPath: "/opt/homebrew/bin/python3",
    });
    expect(target.capabilities.canUpdate).toBe(false);
    expect(target.update).toBeUndefined();
  });

  test("updates a managed vLLM virtual environment", () => {
    const target = makeRuntimeTarget({
      backend: "vllm",
      kind: "venv",
      source: "configured",
      key: "/data/runtimes/vllm/bin/python",
      label: "Managed vLLM",
      installed: true,
      pythonPath: "/data/runtimes/vllm/bin/python",
    });
    expect(target.capabilities.canUpdate).toBe(true);
    expect(target.update?.packageSpec).toContain("vllm");
  });

  test("updates a managed MLX virtual environment", () => {
    const target = makeRuntimeTarget({
      backend: "mlx",
      kind: "venv",
      source: "configured",
      key: "/data/runtimes/mlx/bin/python",
      label: "Managed MLX",
      installed: true,
      pythonPath: "/data/runtimes/mlx/bin/python",
    });
    expect(target.capabilities.canUpdate).toBe(true);
    expect(target.update?.packageSpec).toBe("mlx-lm");
  });
});
