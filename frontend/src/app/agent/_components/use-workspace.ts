"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { PROJECTS_CHANGED_EVENT, loadAgentProjects } from "@/components/projects-nav-section";
import {
  sanitizeLocalFileUrl,
  sanitizePublicBrowserUrl,
} from "@/lib/sanitize-embedded-browser-url";
import { safeJson } from "@/lib/agent/safe-json";
import { loadInitialFromStorage } from "@/lib/agent/workspace/persistence";
import {
  clampComputerWidth,
  createInitialState,
  newPaneId,
  newRuntimeId,
  reducer,
} from "@/lib/agent/workspace/store";
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
  GitSummary,
  PaneId,
  ProjectEntry,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/agent/workspace/types";
import { makeFreshTab, type ChatPaneHandle, type SessionTab } from "./chat-pane";
import type { AgentBrowserHandle } from "./agent-browser";
import type { SessionDropPayload } from "./pane-grid";

const BROWSER_COMMAND_TIMEOUT_MS = 12_000;
const DEFAULT_BROWSER_URL = "https://www.google.com";

type BrowserCommandResult = { ok: boolean; data?: unknown; error?: string };
type BrowserCommand = { id: string; verb: string; payload: Record<string, unknown> };

export type WorkspaceHandles = {
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  registerComputerAside: (element: HTMLElement | null) => void;
  openNewSessionInFocusedPane: (project?: ProjectEntry) => void;
  replaySessionInFocusedPane: (piSessionId: string) => void;
  replaySessionInSplitPane: (piSessionId: string) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  focusTab: (paneId: PaneId, tabId: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  selectProject: (project: ProjectEntry | null) => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerTab: (tab: WorkspaceState["computer"]["tab"]) => void;
  toggleBrowserTool: () => void;
  setComputerWidth: (width: number) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
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
  selectPaneProject: (paneId: PaneId, project: ProjectEntry) => void;
  selectPaneModel: (paneId: PaneId, modelId: string) => void;
  notifySessionsChanged: () => void;
  submitBrowserUrl: (event: FormEvent) => void;
  startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  initGitForActiveProject: () => Promise<void>;
};

export type UseWorkspaceResult = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

function withBrowserTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${BROWSER_COMMAND_TIMEOUT_MS / 1000}s`));
    }, BROWSER_COMMAND_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function detectBotProtection(text: string): string | null {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("our systems have detected unusual traffic") ||
    normalized.includes("/sorry/") ||
    normalized.includes("captcha") ||
    normalized.includes("not a robot")
  ) {
    return "Bot-protection page detected. Stop automated browser use for this page and ask the user to intervene or use a non-browser search source.";
  }
  return null;
}

function encodeFilePath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${withLeadingSlash.split("/").map(encodeURIComponent).join("/")}`;
}

function resolveRelativeFilePath(cwd: string, value: string): string {
  const segments = `${cwd.replace(/\/+$/, "")}/${value}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
}

function expandHomeFilePath(cwd: string, value: string): string | null {
  const homeMatch = cwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(?:\/|$)/);
  if (!homeMatch) return null;
  return `${homeMatch[1]}${value.slice(1)}`;
}

function isSafeBrowserSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 240 && !/[`;{}]/.test(selector);
}

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

function normalizeBrowserInput(raw: string, cwd: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^file:\/\//i.test(value)) {
    return sanitizeLocalFileUrl(value) ?? "";
  }
  if (value.startsWith("~/") && cwd) {
    const expanded = expandHomeFilePath(cwd, value);
    if (expanded) return encodeFilePath(expanded);
  }
  if (value.startsWith("/")) return encodeFilePath(value);
  if ((value.startsWith("./") || value.startsWith("../")) && cwd) {
    return encodeFilePath(resolveRelativeFilePath(cwd, value));
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w.-]+:\d+([/?#].*)?$/.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(value)) {
    return `https://${value}`;
  }
  if (value.includes("/") && cwd) {
    return encodeFilePath(resolveRelativeFilePath(cwd, value));
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
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

function focusedProjectPath(state: WorkspaceState): string | null {
  const focusedPane = state.panesById.get(state.focusedPaneId);
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const activeProject =
    state.projects.find((entry) => entry.id === state.selectedProjectId) ?? null;
  const focusedProject =
    state.projects.find((entry) => entry.id === focusedTab?.projectId) ??
    state.projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;
  return focusedProject?.path ?? null;
}

function hasExplicitSessionNav(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("session") || params.get("new"));
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
    loadProjects: loadAgentProjects,
    loadGitSummary: async (cwd: string): Promise<GitSummary | null> => {
      const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
        cache: "no-store",
      });
      const payload = await safeJson<{
        isRepo?: boolean;
        branch?: string | null;
        additions?: number;
        deletions?: number;
        status?: string[];
      }>(response);
      return {
        isRepo: payload.isRepo === true,
        branch: payload.branch ?? null,
        additions: payload.additions ?? 0,
        deletions: payload.deletions ?? 0,
        statusCount: payload.status?.length ?? 0,
      };
    },
  };
}

export function useWorkspace(): UseWorkspaceResult {
  const [state, reducerDispatch] = useReducer(reducer, undefined, createInitialState);
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
        hasExplicitSessionNav,
        queueReplay: queueSessionReplay,
        browserEvents: getBrowserEvents(),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (action: WorkspaceAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, action);
      if (action.type === "WORKSPACE_UNMOUNTED") {
        const deps = makeDeps(workspaceDispatch);
        if (deps) runWorkspaceEffect(action, prev, next, deps);
        return;
      }
      stateRef.current = next;
      reducerDispatch(action);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(action, prev, next, deps);
    };

    const runBrowserCommand = async (
      verb: string,
      payload: Record<string, unknown>,
    ): Promise<BrowserCommandResult> => {
      const webview = browserRef.current?.webview ?? null;
      const browserWindow = typeof window !== "undefined" ? window : null;
      const isElectron = Boolean(browserWindow?.navigator.userAgent.match(/electron/i));
      if (isElectron && webview && typeof webview.executeJavaScript === "function") {
        try {
          switch (verb) {
            case "navigate": {
              const url = sanitizePublicBrowserUrl(String(payload.url || ""));
              if (!url) return { ok: false, error: "valid public http(s) url required" };
              await withBrowserTimeout(webview.loadURL(url), "Browser navigation");
              workspaceDispatch({ type: "SET_BROWSER_URL", url, input: url });
              return { ok: true, data: { url } };
            }
            case "get-url":
              return { ok: true, data: { url: webview.getURL(), title: webview.getTitle() } };
            case "get-text": {
              const value = await withBrowserTimeout(
                webview.executeJavaScript("document.body && document.body.innerText"),
                "Browser text read",
              );
              const text = typeof value === "string" ? value : "";
              const protectionError = detectBotProtection(text);
              return protectionError
                ? { ok: false, error: protectionError }
                : { ok: true, data: { text } };
            }
            case "get-html": {
              const value = await withBrowserTimeout(
                webview.executeJavaScript(
                  "document.documentElement && document.documentElement.outerHTML",
                ),
                "Browser HTML read",
              );
              const html = typeof value === "string" ? value : "";
              const protectionError = detectBotProtection(html);
              return protectionError
                ? { ok: false, error: protectionError }
                : { ok: true, data: { html } };
            }
            case "screenshot": {
              const image = await withBrowserTimeout(webview.capturePage(), "Browser screenshot");
              return { ok: true, data: { dataUri: image.toDataURL() } };
            }
            case "click": {
              const selector = String(payload.selector || "");
              if (!selector) return { ok: false, error: "selector required" };
              if (!isSafeBrowserSelector(selector)) {
                return { ok: false, error: "unsupported selector" };
              }
              const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; (el).click(); return { found: true }; })()`;
              const value = await withBrowserTimeout(
                webview.executeJavaScript(script, true),
                "Browser click",
              );
              const found = isRecord(value) && value.found === true;
              return {
                ok: found,
                data: { found },
                error: found ? undefined : "selector not found",
              };
            }
            case "scroll": {
              const rawDeltaY = Number(payload.deltaY ?? 0);
              const deltaY = Number.isFinite(rawDeltaY)
                ? Math.max(-10_000, Math.min(10_000, Math.trunc(rawDeltaY)))
                : 0;
              await withBrowserTimeout(
                webview.executeJavaScript(`window.scrollBy(0, ${deltaY})`),
                "Browser scroll",
              );
              const scrollY = await withBrowserTimeout(
                webview.executeJavaScript("window.scrollY"),
                "Browser scroll position read",
              );
              return { ok: true, data: { deltaY, scrollY } };
            }
            case "fill": {
              const selector = String(payload.selector || "");
              const value = String(payload.value ?? "");
              if (!selector) return { ok: false, error: "selector required" };
              if (!isSafeBrowserSelector(selector)) {
                return { ok: false, error: "unsupported selector" };
              }
              const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { found: true }; })()`;
              const result = await withBrowserTimeout(
                webview.executeJavaScript(script, true),
                "Browser fill",
              );
              const found = isRecord(result) && result.found === true;
              return {
                ok: found,
                data: { found },
                error: found ? undefined : "selector not found",
              };
            }
            default:
              return { ok: false, error: `Unsupported browser verb: ${verb}` };
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      const iframe = browserRef.current?.iframe ?? null;
      if (!iframe && verb === "get-url") {
        return { ok: true, data: { url: stateRef.current.browserUrl, title: "" } };
      }
      if (!iframe) return { ok: false, error: "Browser panel not mounted" };
      switch (verb) {
        case "navigate": {
          const url = sanitizePublicBrowserUrl(String(payload.url || ""));
          if (!url) return { ok: false, error: "valid public http(s) url required" };
          iframe.src = url;
          workspaceDispatch({ type: "SET_BROWSER_URL", url, input: url });
          return { ok: true, data: { url } };
        }
        case "get-url":
          return { ok: true, data: { url: iframe.src, title: "" } };
        default:
          return {
            ok: false,
            error: `Browser tool '${verb}' is only available in the desktop app (cross-origin iframe restriction in dev).`,
          };
      }
    };
    return { dispatch: workspaceDispatch, runBrowserCommand };
  }, [queueSessionReplay, reducerDispatch]);

  const { dispatch, runBrowserCommand } = controller;

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerBrowserHandle: (handle: AgentBrowserHandle | null) => {
        browserRef.current = handle;
      },
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openNewSessionInFocusedPane: (project?: ProjectEntry) =>
        dispatch({ type: "OPEN_NEW_SESSION", project }),
      replaySessionInFocusedPane: (piSessionId: string) =>
        dispatch({ type: "REPLAY_SESSION", piSessionId }),
      replaySessionInSplitPane: (piSessionId: string) =>
        dispatch({ type: "REPLAY_SESSION_IN_SPLIT", piSessionId }),
      openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) =>
        dispatch({ type: "OPEN_SESSION_PAYLOAD_IN_PANE", paneId, payload }),
      renameTab: (paneId: PaneId, tabId: string, title: string) =>
        dispatch({ type: "RENAME_TAB", paneId, tabId, title }),
      focusTab: (paneId: PaneId, tabId: string) => dispatch({ type: "FOCUS_TAB", paneId, tabId }),
      splitTabIntoNewPane: (paneId: PaneId, tabId: string) =>
        dispatch({ type: "SPLIT_TAB", sourcePaneId: paneId, sourceTabId: tabId }),
      selectProject: (project: ProjectEntry | null) =>
        dispatch({ type: "SELECT_PROJECT", project }),
      setBrowserUrl: (url: string, input?: string) =>
        dispatch({ type: "SET_BROWSER_URL", url, input }),
      setBrowserInput: (input: string) => dispatch({ type: "SET_BROWSER_INPUT", input }),
      setComputerTab: (tab: WorkspaceState["computer"]["tab"]) =>
        dispatch({ type: "SET_COMPUTER_TAB", tab }),
      toggleBrowserTool: () => dispatch({ type: "TOGGLE_BROWSER_TOOL" }),
      setComputerWidth: (width: number) => dispatch({ type: "SET_COMPUTER_WIDTH", width }),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
        const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
        if (handle && pendingSessionId) queueSessionReplay(paneId, pendingSessionId);
      },
      runBrowserCommand,
      setComputerOpen: (open: boolean) => dispatch({ type: "SET_COMPUTER_OPEN", open }),
      toggleComputerOpen: () => dispatch({ type: "TOGGLE_COMPUTER_OPEN" }),
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch({ type: "SET_SPLIT_RATIO", path, ratio }),
      setPaneTabs: (
        paneId: PaneId,
        tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
      ) => {
        const pane = stateRef.current.panesById.get(paneId);
        if (!pane) return;
        dispatch({
          type: "SET_PANE_TABS",
          paneId,
          tabs: typeof tabs === "function" ? tabs(pane.tabs) : tabs,
        });
      },
      patchActiveTab: (paneId: PaneId, patch: Partial<SessionTab>) =>
        dispatch({ type: "PATCH_ACTIVE_TAB", paneId, patch }),
      closePane: (paneId: PaneId) => dispatch({ type: "CLOSE_PANE", paneId }),
      splitPaneWithPayload: (
        paneId: PaneId,
        direction: "vertical" | "horizontal",
        side: "a" | "b",
        payload: SessionDropPayload,
      ) =>
        dispatch({
          type: "SPLIT_PANE_WITH_PAYLOAD",
          paneId,
          direction,
          side,
          payload,
          newPaneId: newPaneId(),
          runtimeSessionId: newRuntimeId(),
          tab: makeFreshTab(),
        }),
      selectPaneProject: (paneId: PaneId, project: ProjectEntry) =>
        dispatch({
          type: "PATCH_ACTIVE_TAB",
          paneId,
          patch: { projectId: project.id, cwd: project.path },
        }),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch({ type: "PATCH_ACTIVE_TAB", paneId, patch: { modelId } }),
      notifySessionsChanged: () => dispatch({ type: "NOTIFY_SESSIONS_CHANGED" }),
      submitBrowserUrl: (event: FormEvent) => {
        event.preventDefault();
        const next = normalizeBrowserInput(
          stateRef.current.browserInput,
          stateRef.current.agentCwd,
        );
        if (!next) return;
        dispatch({ type: "SET_BROWSER_URL", url: next, input: next });
      },
      startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (typeof window === "undefined") return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = stateRef.current.computer.width;
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
          dispatch({ type: "SET_COMPUTER_WIDTH", width: next });
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      initGitForActiveProject: async () => {
        const cwd = focusedProjectPath(stateRef.current);
        if (!cwd) return;
        const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
          method: "POST",
        });
        if (!response.ok) {
          const payload = await safeJson<{ error?: string }>(response);
          dispatch({
            type: "setError",
            error: payload.error || "Failed to initialize git repository",
          });
          return;
        }
        const summary = await api().loadGitSummary?.(cwd);
        dispatch({ type: "setGitSummary", cwd, summary: summary ?? null });
        window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      },
    }),
    [dispatch, queueSessionReplay, runBrowserCommand],
  );

  useEffect(() => {
    const hydrated = loadInitialFromStorage(window.localStorage);
    dispatch({ type: "HYDRATE", payload: hydrated });
    const unsub = subscribeWorkspaceWindowEvents(window, dispatch);
    return unsub;
  }, []);

  return { state, dispatch, handles };
}
