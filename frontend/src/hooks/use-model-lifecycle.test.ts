import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LaunchProgressData, ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { useModelLifecycle } from "./use-model-lifecycle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type RealtimeFixture = ReturnType<typeof createRealtimeFixture>;
type RealtimeSnapshot = {
  status: { running: boolean; process: ProcessInfo | null; inference_port: number };
  gpus: [];
  metrics: null;
  launchProgress: LaunchProgressData | null;
  platformKind: null;
  runtimeSummary: null;
  services: [];
  lease: null;
  jobs: [];
  isConnected: boolean;
};

const apiMocks = vi.hoisted(() => ({
  getRecipes: vi.fn(),
  launch: vi.fn(),
  evict: vi.fn(),
}));

const realtimeFixture = vi.hoisted(() => ({
  current: null as RealtimeFixture | null,
}));

vi.mock("@/lib/api", () => ({
  default: apiMocks,
}));

vi.mock("./use-realtime-status", () => ({
  useRealtimeStatus: () => realtimeFixture.current?.snapshot,
}));

const recipe = (id: string): RecipeWithStatus =>
  ({
    id,
    name: id,
    backend: "vllm",
    model_path: `/models/${id}`,
    served_model_name: id,
    status: "stopped",
  }) as RecipeWithStatus;

function createRealtimeFixture(): { snapshot: RealtimeSnapshot } {
  return {
    snapshot: {
      status: { running: false, process: null, inference_port: 8000 },
      gpus: [],
      metrics: null,
      launchProgress: null,
      platformKind: null,
      runtimeSummary: null,
      services: [],
      lease: null,
      jobs: [],
      isConnected: true,
    },
  };
}

function renderLifecycleHook() {
  let result: ReturnType<typeof useModelLifecycle> | null = null;
  const element = document.createElement("div");
  const root = createRoot(element);

  const Probe = () => {
    const value = useModelLifecycle();
    useEffect(() => {
      result = value;
    }, [value]);
    return null;
  };

  act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    get result() {
      if (!result) throw new Error("Hook did not render");
      return result;
    },
    rerender() {
      act(() => {
        root.render(React.createElement(Probe));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useModelLifecycle", () => {
  beforeEach(() => {
    realtimeFixture.current = createRealtimeFixture();
    apiMocks.getRecipes.mockResolvedValue({ recipes: [recipe("alpha")] });
    apiMocks.launch.mockResolvedValue({ success: true, message: "Launch started" });
    apiMocks.evict.mockResolvedValue({ success: true, evicted_pid: null });
    vi.stubGlobal("alert", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("derives idle to starting to ready from launch progress and process status", async () => {
    const hook = renderLifecycleHook();
    await flushEffects();

    expect(hook.result.status).toBe("idle");
    await act(async () => {
      await hook.result.start("alpha");
    });

    expect(apiMocks.launch).toHaveBeenCalledWith("alpha", true);
    realtimeFixture.current!.snapshot.launchProgress = {
      recipe_id: "alpha",
      stage: "waiting",
      message: "Loading model...",
    };
    hook.rerender();
    expect(hook.result.status).toBe("starting");

    realtimeFixture.current!.snapshot.status = {
      running: true,
      process: {
        pid: 123,
        backend: "vllm",
        model_path: "/models/alpha",
        port: 8000,
        served_model_name: "alpha",
      },
      inference_port: 8000,
    };
    realtimeFixture.current!.snapshot.launchProgress = {
      recipe_id: "alpha",
      stage: "ready",
      message: "Model is ready!",
    };
    hook.rerender();

    expect(hook.result.status).toBe("ready");
    expect(hook.result.activeRecipeId).toBe("alpha");
    hook.unmount();
  });

  it("derives idle to starting to error from launch progress", async () => {
    const hook = renderLifecycleHook();
    await flushEffects();

    expect(hook.result.status).toBe("idle");
    realtimeFixture.current!.snapshot.launchProgress = {
      recipe_id: "alpha",
      stage: "launching",
      message: "Starting alpha...",
    };
    hook.rerender();
    expect(hook.result.status).toBe("starting");

    realtimeFixture.current!.snapshot.launchProgress = {
      recipe_id: "alpha",
      stage: "error",
      message: "Launch failed",
    };
    hook.rerender();

    expect(hook.result.status).toBe("error");
    expect(hook.result.error).toBe("Launch failed");
    hook.unmount();
  });

  it("records launch request failures without opening a browser alert", async () => {
    apiMocks.launch.mockRejectedValueOnce(new Error("HTTP 504"));
    const hook = renderLifecycleHook();
    await flushEffects();

    await act(async () => {
      await hook.result.start("alpha");
    });

    expect(hook.result.error).toBe("HTTP 504");
    expect(globalThis.alert).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("derives ready to idle after stop evicts the running process", async () => {
    const hook = renderLifecycleHook();
    await flushEffects();
    realtimeFixture.current!.snapshot.status = {
      running: true,
      process: {
        pid: 123,
        backend: "vllm",
        model_path: "/models/alpha",
        port: 8000,
        served_model_name: "alpha",
      },
      inference_port: 8000,
    };
    hook.rerender();
    expect(hook.result.status).toBe("ready");

    await act(async () => {
      await hook.result.stop();
    });
    expect(apiMocks.evict).toHaveBeenCalledWith(true);

    realtimeFixture.current!.snapshot.status = {
      running: false,
      process: null,
      inference_port: 8000,
    };
    hook.rerender();
    expect(hook.result.status).toBe("idle");
    hook.unmount();
  });
});
