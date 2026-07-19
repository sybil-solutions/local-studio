"use client";

import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { safeJson } from "@/features/agent/safe-json";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { clampComputerWidth, gentlySnapComputerWidth } from "@/features/agent/tools/persistence";
import { createInitialState, reducer } from "@/features/agent/workspace/store";
import {
  createSessionReplayQueue,
  type SessionReplayQueue,
} from "@/features/agent/workspace/replay-queue";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import {
  runWorkspaceEffect,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
  type WorkspaceWindow,
} from "@/features/agent/workspace/effects";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { useProjects } from "@/features/agent/projects/context";
import { useToolsRef } from "@/features/agent/tools/context";
import { BACKEND_URL_STORAGE_KEY, getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import {
  CONTROLLERS_STORAGE_KEY,
  loadSavedControllers,
  normalizeControllerUrl,
} from "@/lib/api/controllers";
import type { Session, UpdateSession } from "@/features/agent/runtime/types";
import {
  useWorkspaceHydrationEffects,
  useWorkspaceRuntimeSync,
} from "@/features/agent/ui/use-workspace-effects";
import type { ChatPaneHandle } from "@/features/agent/ui/chat-pane";
import type { SessionDropPayload } from "@/features/agent/ui/pane-grid";
import {
  readDefaultAgentModel,
  writeDefaultAgentModel,
} from "@/features/agent/workspace/model-preference";

export type WorkspaceHandles = {
  registerComputerAside: (element: HTMLElement | null) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  compactFocusedSession: () => Promise<void>;
  setSplitRatio: (path: number[], ratio: number) => void;
  updateSession: UpdateSession;
  updateDetachedSession: (fallback: Session, patch: Parameters<UpdateSession>[1]) => void;
  removeDetachedSession: (sessionId: string) => void;
  closePane: (paneId: PaneId) => void;
  splitPaneWithPayload: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
  selectPaneModel: (paneId: PaneId, modelId: string) => void;
  setDefaultModel: (modelId: string) => void;
  notifySessionsChanged: () => void;
  startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  initGitForActiveProject: () => Promise<void>;
};

export type UseWorkspaceResult = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

export type UseWorkspaceOptions = {
  ephemeral?: boolean;
};

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function createWorkspaceWindow(source: Window): WorkspaceWindow {
  return {
    Event,
    dispatchEvent: source.dispatchEvent.bind(source),
    setTimeout: source.setTimeout.bind(source),
  };
}

function agentModelControllersPayload() {
  const byUrl = new Map<string, { url: string; apiKey?: string; name?: string }>();
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  if (activeUrl) {
    const activeApiKey = getApiKey();
    byUrl.set(activeUrl, {
      url: activeUrl,
      ...(activeApiKey ? { apiKey: activeApiKey } : {}),
      name: "primary",
    });
  }
  for (const controller of loadSavedControllers()) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const existing = byUrl.get(url);
    byUrl.set(url, {
      ...existing,
      url,
      ...(controller.apiKey || existing?.apiKey
        ? { apiKey: controller.apiKey || existing?.apiKey }
        : {}),
      ...(controller.name || existing?.name ? { name: controller.name || existing?.name } : {}),
    });
  }
  return [...byUrl.values()];
}

async function loadAgentModelsPayload(): Promise<{ models?: AgentModel[]; error?: string }> {
  const response = await fetch("/api/agent/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ controllers: agentModelControllersPayload() }),
  });
  const payload = await safeJson<{ models?: AgentModel[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load models");
  return payload;
}

function api(): WorkspaceEffectDeps["api"] {
  return {
    loadSetupChecks: async () => {
      const response = await fetch("/api/agent/setup-checks", { cache: "no-store" });
      return safeJson<{ checks?: Array<{ id: string; ok: boolean; guidance?: string }> }>(response);
    },
    loadModels: async () => {
      return loadAgentModelsPayload();
    },
  };
}

export function useWorkspace({ ephemeral = false }: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const projects = useProjects();
  const projectsRef = useRef(projects);
  const toolsRef = useToolsRef();
  useMountSubscription(() => {
    projectsRef.current = projects;
  }, [projects]);
  const [state, setState] = useState<WorkspaceState>(createInitialState);
  const stateRef = useRef(state);
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const computerAsideRef = useRef<HTMLElement | null>(null);

  const replayQueueRef = useRef<SessionReplayQueue | null>(null);
  const getReplayQueue = useCallback(() => {
    replayQueueRef.current ??= createSessionReplayQueue({
      getHandle: (paneId) => paneHandlesRef.current.get(paneId),
      getState: () => stateRef.current,
      setTimeout: (handler, delay) => window.setTimeout(handler, delay),
    });
    return replayQueueRef.current;
  }, []);
  const queueSessionReplay = useCallback(
    (paneId: PaneId, piSessionId: string) => getReplayQueue().queue(paneId, piSessionId),
    [getReplayQueue],
  );

  const controller = useMemo(() => {
    const ephemeralStorage = ephemeral ? createMemoryStorage() : null;
    const makeDeps = (workspaceDispatch: WorkspaceDispatch): WorkspaceEffectDeps | null => {
      if (typeof window === "undefined") return null;
      return {
        storage: ephemeralStorage ?? window.localStorage,
        window: createWorkspaceWindow(window),
        api: api(),
        dispatch: workspaceDispatch,
        queueReplay: queueSessionReplay,
        selectionFor: (id) => toolsRef.current.selectionFor(id),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (action: WorkspaceAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, action);
      stateRef.current = next;
      setState(next);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(action, prev, next, deps);
    };

    return { dispatch: workspaceDispatch };
  }, [queueSessionReplay, ephemeral]);

  const { dispatch } = controller;

  useMountSubscription(() => {
    if (typeof window === "undefined") return;
    const reload = () => {
      dispatch({ type: "setModelsLoading", loading: true });
      dispatch({ type: "setError", error: "" });
      void loadAgentModelsPayload()
        .then((models) => {
          dispatch({
            type: "setModels",
            models: models.models ?? [],
            preferredModelId: readDefaultAgentModel(window.localStorage),
          });
        })
        .catch((error) => {
          dispatch({
            type: "setError",
            error: error instanceof Error ? error.message : String(error),
          });
          dispatch({ type: "setModels", models: [] });
        })
        .finally(() => dispatch({ type: "setModelsLoading", loading: false }));
    };
    const onStorage = (event: StorageEvent | Event) => {
      const key = (event as StorageEvent).key;
      if (key && key !== BACKEND_URL_STORAGE_KEY && key !== CONTROLLERS_STORAGE_KEY) return;
      reload();
    };
    const recoverIfEmpty = () => {
      if (stateRef.current.models.length === 0 && !stateRef.current.modelsLoading) reload();
    };
    const retryTimers = [900, 2500, 6000].map((ms) => window.setTimeout(recoverIfEmpty, ms));
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", recoverIfEmpty);
    window.addEventListener("online", recoverIfEmpty);
    return () => {
      for (const t of retryTimers) window.clearTimeout(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", recoverIfEmpty);
      window.removeEventListener("online", recoverIfEmpty);
    };
  }, [dispatch]);

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) =>
        dispatch({ type: "openSessionPayloadInPane", paneId, payload, tab: makeFreshTab() }),
      renameTab: (paneId: PaneId, tabId: string, title: string) =>
        dispatch({ type: "renameTab", paneId, tabId, title }),
      splitTabIntoNewPane: (paneId: PaneId, tabId: string) =>
        dispatch({
          type: "splitTab",
          sourcePaneId: paneId,
          sourceTabId: tabId,
          newPaneId: newPaneId(),
          tab: makeFreshTab(),
        }),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
        if (handle) getReplayQueue().notifyHandleRegistered(paneId);
      },
      compactFocusedSession: async () => {
        const handle = paneHandlesRef.current.get(stateRef.current.focusedPaneId);
        await handle?.compact();
      },
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch({ type: "setSplitRatio", path, ratio }),
      updateSession: (sessionId, patch) => dispatch({ type: "patchSession", sessionId, patch }),
      updateDetachedSession: (fallback: Session, patch: Parameters<UpdateSession>[1]) => {
        const current = stateRef.current.sessions.get(fallback.id) ?? fallback;
        dispatch({ type: "setDetachedSession", session: patch(current) });
      },
      removeDetachedSession: (sessionId: string) =>
        dispatch({ type: "removeDetachedSession", sessionId }),
      closePane: (paneId: PaneId) => dispatch({ type: "closePane", paneId }),
      splitPaneWithPayload: (
        paneId: PaneId,
        direction: "vertical" | "horizontal",
        side: "a" | "b",
        payload: SessionDropPayload,
      ) =>
        dispatch({
          type: "splitPaneWithPayload",
          paneId,
          direction,
          side,
          payload,
          newPaneId: newPaneId(),
          tab: makeFreshTab(),
        }),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch({ type: "patchActiveTab", paneId, patch: { modelId } }),
      setDefaultModel: (modelId: string) => {
        writeDefaultAgentModel(ephemeral ? createMemoryStorage() : window.localStorage, modelId);
        dispatch({ type: "setSelectedModel", modelId });
      },
      notifySessionsChanged: () => dispatch({ type: "notifySessionsChanged" }),
      startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (typeof window === "undefined") return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth =
          computerAsideRef.current?.getBoundingClientRect().width ??
          toolsRef.current.computer.width;
        const containerWidth =
          computerAsideRef.current?.parentElement?.getBoundingClientRect().width ??
          window.innerWidth;
        let frame = 0;
        if (computerAsideRef.current) computerAsideRef.current.style.transition = "none";
        const onMove = (moveEvent: MouseEvent) => {
          const next = clampComputerWidth(startWidth + startX - moveEvent.clientX, containerWidth);
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
          });
        };
        const onUp = (upEvent: MouseEvent) => {
          if (frame) cancelAnimationFrame(frame);
          const raw = startWidth + startX - upEvent.clientX;
          const next = gentlySnapComputerWidth(raw, containerWidth);
          if (computerAsideRef.current) {
            computerAsideRef.current.style.transition =
              "width 150ms cubic-bezier(0.22, 1, 0.36, 1)";
            computerAsideRef.current.style.width = `${next}px`;
            window.setTimeout(() => {
              if (computerAsideRef.current) computerAsideRef.current.style.transition = "";
            }, 170);
          }
          toolsRef.current.setComputerWidth(next);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      initGitForActiveProject: async () => {
        try {
          await projectsRef.current.initGitForActiveProject();
        } catch (error) {
          dispatch({
            type: "setError",
            error: error instanceof Error ? error.message : "Failed to initialize git repository",
          });
        }
      },
    }),
    [dispatch, ephemeral, getReplayQueue],
  );

  useWorkspaceHydrationEffects({ dispatch, toolsRef, skipRestore: ephemeral });
  useWorkspaceRuntimeSync({ dispatch, sessions: [...state.sessions.values()] });

  return { state, dispatch, handles };
}
