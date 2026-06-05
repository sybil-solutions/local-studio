"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { safeJson } from "@/lib/agent/safe-json";
import { clampComputerWidth, gentlySnapComputerWidth } from "@/lib/agent/tools/persistence";
import { createInitialState, reducer } from "@/lib/agent/workspace/store";
import { makeFreshTab, newPaneId, newRuntimeId } from "@/lib/agent/session/helpers";
import {
  runWorkspaceEffect,
  type BrowserEventsSubscription,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
  type WorkspaceWindow,
} from "@/lib/agent/workspace/effects";
import { useWorkspaceHydrationEffects } from "@/hooks/agent/use-workspace-hydration-effects";
import { useBrowserEventsEffects } from "@/hooks/agent/use-browser-events-effects";
import { useWorkspaceRuntimeSync } from "@/hooks/agent/use-workspace-runtime-sync";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/agent/workspace/types";
import { useProjects } from "@/lib/agent/projects/context";
import { useTools } from "@/lib/agent/tools/context";
import { getApiKey } from "@/lib/api-key";
import { getStoredBackendUrl } from "@/lib/backend-url";
import { loadSavedControllers, normalizeControllerUrl } from "@/lib/controllers";
import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";
import type { Project } from "@/lib/agent/projects/types";
import { paneSessions } from "@/lib/agent/sessions/selectors";
import { runBrowserPanelCommand, type BrowserCommandResult } from "@/lib/agent/browser/command";
import type { ChatPaneHandle, SessionTab } from "./chat-pane";
import type { AgentBrowserHandle } from "./agent-browser";
import type { SessionDropPayload } from "./pane-grid";
import {
  browserHostIsReady,
  browserSessionIsKnown,
  createBrowserEvents,
  focusedBrowserSessionId,
  waitForBrowserHost,
} from "./use-workspace-browser-events";

export type WorkspaceHandles = {
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  registerComputerAside: (element: HTMLElement | null) => void;
  openNewSessionInFocusedPane: (project?: Project) => void;
  replaySessionInFocusedPane: (piSessionId: string) => void;
  replaySessionInSplitPane: (piSessionId: string) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  selectProject: (project: Project | null) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  compactFocusedSession: () => Promise<void>;
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>;
  setSplitRatio: (path: number[], ratio: number) => void;
  setPaneTabs: (
    paneId: PaneId,
    tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
  ) => void;
  patchActiveTab: (paneId: PaneId, patch: Partial<SessionTab>) => void;
  closePane: (paneId: PaneId) => void;
  splitPaneWithPayload: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
  selectPaneProject: (paneId: PaneId, project: Project) => void;
  selectPaneModel: (paneId: PaneId, modelId: string) => void;
  notifySessionsChanged: () => void;
  startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  initGitForActiveProject: () => Promise<void>;
};

export type UseWorkspaceResult = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

function createWorkspaceWindow(source: Window): WorkspaceWindow {
  return {
    Event,
    CustomEvent,
    dispatchEvent: source.dispatchEvent.bind(source),
    addEventListener: source.addEventListener.bind(source),
    removeEventListener: source.removeEventListener.bind(source),
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

export function useWorkspace(): UseWorkspaceResult {
  const projects = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const tools = useTools();
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const [state, setState] = useState<WorkspaceState>(createInitialState);
  const stateRef = useRef(state);
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const pendingSessionReplaysRef = useRef<Map<PaneId, string>>(new Map());
  const browserRef = useRef<AgentBrowserHandle | null>(null);
  const computerAsideRef = useRef<HTMLElement | null>(null);

  const queueSessionReplay = useMemo(
    () => (paneId: PaneId, sessionId: string) => {
      pendingSessionReplaysRef.current.set(paneId, sessionId);
      window.setTimeout(() => {
        const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
        const handle = paneHandlesRef.current.get(paneId);
        if (!pendingSessionId || !handle) return;
        // Only replay onto the session this replay was queued for. A "+" click
        // (or any swap) replaces a pane's session in place under the same paneId;
        // a fresh empty starter has nothing to replay, so a stale pending replay
        // landing here would overwrite the new chat with the old transcript —
        // the "+ opens the old chat" bug. Drop the replay in that case.
        const pane = stateRef.current.panesById.get(paneId);
        const current = pane ? stateRef.current.sessions.get(pane.sessionId) : undefined;
        const isFreshStarter =
          !!current &&
          current.piSessionId == null &&
          current.messages.length === 0 &&
          current.status === "idle";
        if (!current || isFreshStarter) {
          pendingSessionReplaysRef.current.delete(paneId);
          return;
        }
        pendingSessionReplaysRef.current.delete(paneId);
        void handle.loadAndReplay(pendingSessionId);
      }, 0);
    },
    [],
  );

  const controller = useMemo(() => {
    let browserEvents: BrowserEventsSubscription | null = null;
    const getBrowserEvents = () => {
      browserEvents ??= createBrowserEvents(runBrowserCommand, (sessionId) => ({
        focused: focusedBrowserSessionId(stateRef.current),
        known: browserSessionIsKnown(stateRef.current, sessionId),
      }));
      return browserEvents;
    };
    const makeDeps = (workspaceDispatch: WorkspaceDispatch): WorkspaceEffectDeps | null => {
      if (typeof window === "undefined") return null;
      return {
        storage: window.localStorage,
        window: createWorkspaceWindow(window),
        api: api(),
        dispatch: workspaceDispatch,
        queueReplay: queueSessionReplay,
        browserEvents: getBrowserEvents(),
        findProjectById: (id) => projectsRef.current.findById(id),
        selectionFor: (id) => toolsRef.current.selectionFor(id),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (action: WorkspaceAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, action);
      if (action.type === "workspaceUnmounted") {
        const deps = makeDeps(workspaceDispatch);
        if (deps) runWorkspaceEffect(action, prev, next, deps);
        return;
      }
      stateRef.current = next;
      setState(next);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(action, prev, next, deps);
    };

    const runBrowserCommand = async (
      verb: string,
      payload: Record<string, unknown>,
    ): Promise<BrowserCommandResult> => {
      const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
      const currentTools = toolsRef.current;
      const hadBrowserHost = browserHostIsReady(browserRef.current, isElectron);
      // A `navigate` is real, intentional browser use: open the panel so the
      // webview host mounts and the user can watch. Passive verbs (get-url,
      // get-text, screenshot, etc.) only register/select the browser tab without
      // popping the panel — that combination fixes both the "browser opens on
      // every prompt" annoyance and the model losing browser access when the
      // panel is closed.
      currentTools.setBrowserEnabled(true);
      if (verb === "navigate") {
        currentTools.setComputerTab("browser");
        const nextUrl = sanitizePublicBrowserUrl(String(payload.url || ""));
        if (nextUrl && !hadBrowserHost) currentTools.setBrowserUrl(nextUrl, nextUrl);
      } else {
        currentTools.selectComputerTabWithoutOpening("browser");
      }
      if (verb !== "get-url") {
        await waitForBrowserHost(() => browserRef.current, isElectron);
      }
      return runBrowserPanelCommand(verb, payload, {
        browser: browserRef.current,
        currentUrl: toolsRef.current.browser.url,
        setBrowserUrl: toolsRef.current.setBrowserUrl,
        isElectron,
      });
    };
    return { browserEvents: getBrowserEvents(), dispatch: workspaceDispatch, runBrowserCommand };
  }, [queueSessionReplay]);

  const { browserEvents, dispatch, runBrowserCommand } = controller;

  useBrowserEventsEffects({ browserEvents, enabled: tools.browser.enabled });

  const subscribeWorkspaceModelStorage = useCallback(
    (_notify: () => void) => {
      if (typeof window === "undefined") return () => {};
      const reload = () => {
        dispatch({ type: "setModelsLoading", loading: true });
        dispatch({ type: "setError", error: "" });
        void loadAgentModelsPayload()
          .then((models) => {
            dispatch({ type: "setModels", models: models.models ?? [] });
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
        if (key && key !== "vllmstudio_backend_url" && key !== "vllm-studio.controllers") return;
        reload();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    [dispatch],
  );

  useSyncExternalStore(
    subscribeWorkspaceModelStorage,
    getWorkspaceModelStorageSnapshot,
    getWorkspaceModelStorageSnapshot,
  );

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerBrowserHandle: (handle: AgentBrowserHandle | null) => {
        browserRef.current = handle;
      },
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openNewSessionInFocusedPane: (project?: Project) => {
        if (project) projectsRef.current.selectProject(project);
        dispatch({
          type: "openNewSession",
          project,
          tab: makeFreshTab(),
          paneId: newPaneId(),
          runtimeSessionId: newRuntimeId(),
        });
      },
      replaySessionInFocusedPane: (piSessionId: string) =>
        dispatch({ type: "replaySession", piSessionId, tab: makeFreshTab() }),
      replaySessionInSplitPane: (piSessionId: string) =>
        dispatch({
          type: "replaySessionInSplit",
          piSessionId,
          paneId: newPaneId(),
          runtimeSessionId: newRuntimeId(),
          tab: makeFreshTab(),
        }),
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
          runtimeSessionId: newRuntimeId(),
          tab: makeFreshTab(),
        }),
      selectProject: (project: Project | null) => projectsRef.current.selectProject(project),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
        const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
        if (handle && pendingSessionId) queueSessionReplay(paneId, pendingSessionId);
      },
      compactFocusedSession: async () => {
        const handle = paneHandlesRef.current.get(stateRef.current.focusedPaneId);
        await handle?.compact();
      },
      runBrowserCommand,
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch({ type: "setSplitRatio", path, ratio }),
      setPaneTabs: (
        paneId: PaneId,
        tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
      ) => {
        const pane = stateRef.current.panesById.get(paneId);
        if (!pane) return;
        const current = paneSessions(stateRef.current, paneId);
        const next = typeof tabs === "function" ? tabs(current) : tabs;
        const session = next.at(-1) ?? current[0];
        if (!session) return;
        dispatch({
          type: "setPaneSession",
          paneId,
          session,
        });
      },
      patchActiveTab: (paneId: PaneId, patch: Partial<SessionTab>) =>
        dispatch({ type: "patchActiveTab", paneId, patch }),
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
          runtimeSessionId: newRuntimeId(),
          tab: makeFreshTab(),
        }),
      selectPaneProject: (paneId: PaneId, project: Project) =>
        dispatch({
          type: "patchActiveTab",
          paneId,
          patch: { projectId: project.id, cwd: project.path },
        }),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch({ type: "patchActiveTab", paneId, patch: { modelId } }),
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
    [dispatch, queueSessionReplay, runBrowserCommand],
  );

  useWorkspaceHydrationEffects({ dispatch, projectsRef, toolsRef });
  useWorkspaceRuntimeSync({ dispatch, sessions: [...state.sessions.values()] });

  return { state, dispatch, handles };
}

const getWorkspaceModelStorageSnapshot = (): number => 0;
