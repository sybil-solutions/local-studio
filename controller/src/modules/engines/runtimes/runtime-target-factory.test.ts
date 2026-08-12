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

  test("installs an absent WSL2 engine and updates or removes a managed one", () => {
    const available = makeRuntimeTarget({
      backend: "vllm",
      kind: "wsl2",
      source: "discovered",
      key: "Ubuntu",
      label: "vLLM via WSL2 (Ubuntu)",
      installed: false,
      binaryPath: "vllm",
      wslDistribution: "Ubuntu",
      healthStatus: "warning",
      healthMessage: "Install required.",
    });
    const installed = makeRuntimeTarget({
      backend: "vllm",
      kind: "wsl2",
      source: "discovered",
      key: "Ubuntu",
      label: "vLLM via WSL2 (Ubuntu)",
      installed: true,
      binaryPath: "/home/user/vllm-latest/bin/vllm",
      wslDistribution: "Ubuntu",
      version: "0.19.1",
    });

    expect(available.capabilities.canLaunch).toBe(false);
    expect(available.capabilities.canInstall).toBe(true);
    expect(available.capabilities.canUpdate).toBe(false);
    expect(available.capabilities.canUninstall).toBe(false);
    expect(installed.capabilities.canLaunch).toBe(true);
    expect(installed.capabilities.canInstall).toBe(false);
    expect(installed.capabilities.canUpdate).toBe(true);
    expect(installed.capabilities.canUninstall).toBe(true);
    expect(installed.capabilities.canInspectOptions).toBe(false);
    expect(installed.wslDistribution).toBe("Ubuntu");
  });
});
