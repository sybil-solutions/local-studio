import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPUTER_WIDTH_KEY, PANE_STATE_KEY } from "@/lib/agent/workspace/store";
import type { ProjectEntry } from "@/lib/agent/workspace/types";
import { useWorkspace } from "./use-workspace";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NEW_AGENT_SESSION_EVENT = "vllm-studio.agent.newSession";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function project(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: "proj-1",
    name: "Project",
    path: "/tmp/project",
    addedAt: "2026-05-11T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "main",
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockWorkspaceFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes("/api/agent/setup-checks")) return jsonResponse({ checks: [] });
    if (url.includes("/api/agent/models")) return jsonResponse({ models: [] });
    if (url.includes("/api/agent/projects")) return jsonResponse({ projects: [] });
    if (url.includes("/api/agent/git-diff")) {
      return jsonResponse({ isRepo: false, status: [] });
    }
    return jsonResponse({});
  });
}

function renderHook<T>(hook: () => T) {
  let current: T | undefined;
  const host = document.createElement("div");
  let root: Root | null = null;

  function TestHook() {
    current = hook();
    return null;
  }

  act(() => {
    root = createRoot(host);
    root.render(<TestHook />);
  });

  return {
    result: {
      get current(): T {
        if (current === undefined) throw new Error("hook has not rendered");
        return current;
      },
    },
    rerender() {
      act(() => {
        root?.render(<TestHook />);
      });
    },
    unmount() {
      act(() => {
        root?.unmount();
      });
    },
  };
}

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWorkspace", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
    vi.stubGlobal("fetch", mockWorkspaceFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("hydrates from localStorage only once", async () => {
    const getItem = vi.spyOn(window.localStorage, "getItem");
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    const widthReadsAfterMount = getItem.mock.calls.filter(
      ([key]) => key === COMPUTER_WIDTH_KEY,
    ).length;
    hook.rerender();

    expect(getItem.mock.calls.filter(([key]) => key === COMPUTER_WIDTH_KEY)).toHaveLength(
      widthReadsAfterMount,
    );
    hook.unmount();
  });

  it("dispatching OPEN_NEW_SESSION mutates state and writes localStorage", async () => {
    const selected = project();
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    act(() => {
      hook.result.current.dispatch({ type: "OPEN_NEW_SESSION", project: selected });
    });

    expect(hook.result.current.state.selectedProjectId).toBe(selected.id);
    expect(hook.result.current.state.agentCwd).toBe(selected.path);
    expect(window.localStorage.getItem(PANE_STATE_KEY)).toBeTruthy();
    hook.unmount();
  });

  it("window new-session event triggers the reducer", async () => {
    const selected = project();
    const hook = renderHook(() => useWorkspace());
    await flushAsyncEffects();

    act(() => {
      hook.result.current.dispatch({ type: "setProjects", projects: [selected] });
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent(NEW_AGENT_SESSION_EVENT, { detail: { projectId: selected.id } }),
      );
    });

    expect(hook.result.current.state.selectedProjectId).toBe(selected.id);
    expect(hook.result.current.state.agentCwd).toBe(selected.path);
    hook.unmount();
  });
});
