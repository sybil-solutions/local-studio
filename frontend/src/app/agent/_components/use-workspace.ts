"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { safeJson } from "@/lib/agent/safe-json";
import { clampComputerWidth } from "@/lib/agent/tools/persistence";
import { loadInitialFromStorage } from "@/lib/agent/workspace/persistence";
import { createInitialState, reducer } from "@/lib/agent/workspace/store";
import { makeFreshTab, newPaneId, newRuntimeId } from "@/lib/agent/session/helpers";
import {
  runWorkspaceEffect,
  subscribeWorkspaceWindowEvents,
  type BrowserEventsSubscription,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
  type WorkspaceWindow,
} from "@/lib/agent/workspace/effects";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/agent/workspace/types";
import { useProjects } from "@/lib/agent/projects/context";
import { useTools } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { paneSessions } from "@/lib/agent/sessions/selectors";
import { runBrowserPanelCommand, type BrowserCommandResult } from "@/lib/agent/browser/command";
import type { ChatPaneHandle, SessionTab } from "./chat-pane";
import type { AgentBrowserHandle } from "./agent-browser";
import type { SessionDropPayload } from "./pane-grid";

type BrowserCommand = { id: string; verb: string; payload: Record<string, unknown> };

export type WorkspaceHandles = {
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  registerComputerAside: (element: HTMLElement | null) => void;
  openNewSessionInFocusedPane: (project?: Project) => void;
  replaySessionInFocusedPane: (piSessionId: string) => void;
  replaySessionInSplitPane: (piSessionId: string) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  focusTab: (paneId: PaneId, tabId: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  selectProject: (project: Project | null) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBrowserCommand(raw: string): BrowserCommand | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const id = parsed.id;
    const verb = parsed.verb;
    const payload = parsed.payload;
    if (typeof id !== "string" || typeof verb !== "string" || !isRecord(payload)) return null;
    return { id, verb, payload };
  } catch {
    return null;
  }
}

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

function createBrowserEvents(
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>,
): BrowserEventsSubscription {
  let source: EventSource | null = null;
  let enabled = false;

  const close = () => {
    source?.close();
    source = null;
  };

  return {
    setEnabled(nextEnabled) {
      if (enabled === nextEnabled && source) return;
      enabled = nextEnabled;
      close();
      if (!enabled || typeof EventSource === "undefined") return;
      source = new EventSource("/api/agent/browser/events");
      source.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        const command = parseBrowserCommand(event.data);
        if (!command || typeof fetch !== "function") return;
        void runBrowserCommand(command.verb, command.payload)
          .then((result) =>
            fetch("/api/agent/browser/result", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: command.id, ...result }),
            }),
          )
          .catch((error) => {
            console.warn("[agent] browser bridge dispatch failed", error);
          });
      };
    },
    close() {
      enabled = false;
      close();
    },
  };
}

function api(): WorkspaceEffectDeps["api"] {
  return {
    loadSetupChecks: async () => {
      const response = await fetch("/api/agent/setup-checks", { cache: "no-store" });
      return safeJson<{ checks?: Array<{ id: string; ok: boolean; guidance?: string }> }>(response);
    },
    loadModels: async () => {
      const response = await fetch("/api/agent/models", { cache: "no-store" });
      const payload = await safeJson<{ models?: AgentModel[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Failed to load models");
      return payload;
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
        pendingSessionReplaysRef.current.delete(paneId);
        void handle.loadAndReplay(pendingSessionId);
      }, 0);
    },
    [],
  );

  const controller = useMemo(() => {
    let browserEvents: BrowserEventsSubscription | null = null;
    const getBrowserEvents = () => {
      browserEvents ??= createBrowserEvents(runBrowserCommand);
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
    ): Promise<BrowserCommandResult> =>
      runBrowserPanelCommand(verb, payload, {
        browser: browserRef.current,
        currentUrl: toolsRef.current.browser.url,
        setBrowserUrl: toolsRef.current.setBrowserUrl,
        isElectron: typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent),
      });
    return { dispatch: workspaceDispatch, runBrowserCommand };
  }, [queueSessionReplay]);

  const { dispatch, runBrowserCommand } = controller;

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
      focusTab: (paneId: PaneId, tabId: string) => dispatch({ type: "focusTab", paneId, tabId }),
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
        dispatch({
          type: "setPaneTabs",
          paneId,
          tabs: typeof tabs === "function" ? tabs(current) : tabs,
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
        const startWidth = toolsRef.current.computer.width;
        let frame = 0;
        const onMove = (moveEvent: MouseEvent) => {
          const next = clampComputerWidth(startWidth + startX - moveEvent.clientX);
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
          });
        };
        const onUp = (upEvent: MouseEvent) => {
          if (frame) cancelAnimationFrame(frame);
          const next = clampComputerWidth(startWidth + startX - upEvent.clientX);
          if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
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

  useEffect(() => {
    const { workspace, selections } = loadInitialFromStorage(window.localStorage);
    dispatch({ type: "hydrate", state: workspace });
    if (selections.size > 0) toolsRef.current.hydrateSelections(selections);
    const unsub = subscribeWorkspaceWindowEvents(window, dispatch, (id) =>
      projectsRef.current.findById(id),
    );
    return unsub;
  }, [dispatch]);

  return { state, dispatch, handles };
}
