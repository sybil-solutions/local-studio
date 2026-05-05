"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  loadAgentProjects,
  ACTIVE_AGENT_SESSIONS_EVENT,
  ACTIVE_AGENT_SESSION_OPEN_EVENT,
  ACTIVE_AGENT_SESSION_RENAME_EVENT,
  NEW_AGENT_SESSION_EVENT,
  PROJECTS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
  triggerAddProjectFlow,
} from "@/components/projects-nav-section";
import { sanitizeEmbeddedBrowserUrl } from "@/lib/sanitize-embedded-browser-url";
import { ChevronDownIcon, CloseIcon, ComputerIcon, PlusIcon } from "@/components/icons";
import { safeJson } from "@/lib/agent/safe-json";
import { AgentBrowser, type AgentBrowserHandle, type WebviewElement } from "./agent-browser";
import { ChatPane, makeFreshTab, type ChatPaneHandle, type SessionTab } from "./chat-pane";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import { PaneGrid, type SessionDropPayload } from "./pane-grid";
import {
  collectLeaves,
  removeLeaf,
  setSplitRatio,
  splitLeaf,
  type Layout,
  type PaneId,
} from "./pane-layout";

type AgentModel = {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  active: boolean;
};

type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

type GitSummary = {
  isRepo: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

const DEFAULT_AGENT_CWD = "";
const SELECTED_PROJECT_KEY = "vllm-studio.agent.selectedProjectId";
const BROWSER_TOOL_KEY = "vllm-studio.agent.browserToolEnabled";
const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
const COMPUTER_BROWSER_OPEN_KEY = "vllm-studio.agent.computer.browserOpen";
const BROWSER_COMMAND_TIMEOUT_MS = 12_000;
const COMPUTER_WIDTH_KEY = "vllm-studio.agent.computer.width";
const DEFAULT_COMPUTER_WIDTH = 440;
const MIN_COMPUTER_WIDTH = 320;
const MAX_COMPUTER_WIDTH = 960;

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

function clampComputerWidth(width: number): number {
  return Math.min(MAX_COMPUTER_WIDTH, Math.max(MIN_COMPUTER_WIDTH, Math.round(width)));
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
const COMPUTER_FILES_OPEN_KEY = "vllm-studio.agent.computer.filesOpen";
const COMPUTER_DEFAULT_CLOSED_MIGRATION_KEY = "vllm-studio.agent.computer.defaultClosedMigrated";
const PANE_LAYOUT_KEY = "vllm-studio.agent.paneLayout";

type ComputerTab = "browser" | "files" | "diff";

function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

function isSafeBrowserSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 240 && !/[`;{}]/.test(selector);
}

function newPaneId(): PaneId {
  return `p-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

function newRuntimeId(): string {
  return `rt-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

type PaneState = {
  tabs: SessionTab[];
  activeTabId: string;
  runtimeSessionId: string;
};

export function AgentWorkspace() {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [agentCwd, setAgentCwd] = useState(DEFAULT_AGENT_CWD);
  const [error, setError] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [browserInput, setBrowserInput] = useState("https://www.google.com");
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [browserToolEnabled, setBrowserToolEnabled] = useState(false);
  const [activeComputerTab, setActiveComputerTab] = useState<ComputerTab>("browser");
  const [computerWidth, setComputerWidth] = useState(DEFAULT_COMPUTER_WIDTH);
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);

  // Pane state: a tree-shaped Layout where each leaf is identified by a
  // PaneId and points into panesById, which holds tabs + the per-pane
  // runtime session id used to scope the pi child process and the
  // /api/agent/turn calls. Each tab inside a pane has its own piSessionId
  // (loaded from URL session params or assigned by pi after the first turn).
  const [layout, setLayout] = useState<Layout>(() => ({ kind: "leaf", paneId: "p-init" }));
  const [panesById, setPanesById] = useState<Map<PaneId, PaneState>>(() => {
    const tab = makeFreshTab();
    return new Map([
      [
        "p-init",
        {
          tabs: [tab],
          activeTabId: tab.id,
          runtimeSessionId: `rt-${randomIdSegment(9)}`,
        },
      ],
    ]);
  });
  const [focusedPaneId, setFocusedPaneId] = useState<PaneId>("p-init");

  const browserRef = useRef<AgentBrowserHandle | null>(null);
  const computerAsideRef = useRef<HTMLElement | null>(null);
  const isElectron = typeof window !== "undefined" && /electron/i.test(navigator.userAgent);
  const getWebview = (): WebviewElement | null => browserRef.current?.webview ?? null;
  const getIframe = (): HTMLIFrameElement | null => browserRef.current?.iframe ?? null;
  const searchParams = useSearchParams();

  // Imperative handles registered by each ChatPane. The workspace calls
  // handle.loadAndReplay(piSessionId) directly when the user opens a past
  // session — no useEffect-driven prop chain, no replay races.
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const pendingSessionReplaysRef = useRef<Map<PaneId, string>>(new Map());
  const queueSessionReplay = useCallback((paneId: PaneId, sessionId: string) => {
    pendingSessionReplaysRef.current.set(paneId, sessionId);
    window.setTimeout(() => {
      const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
      const handle = paneHandlesRef.current.get(paneId);
      if (!pendingSessionId || !handle) return;
      pendingSessionReplaysRef.current.delete(paneId);
      void handle.loadAndReplay(pendingSessionId);
    }, 0);
  }, []);
  const registerPaneHandle = useCallback(
    (paneId: PaneId, handle: ChatPaneHandle | null) => {
      if (handle) paneHandlesRef.current.set(paneId, handle);
      else paneHandlesRef.current.delete(paneId);
      const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
      if (handle && pendingSessionId) queueSessionReplay(paneId, pendingSessionId);
    },
    [queueSessionReplay],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      setLoadingModels(true);
      setError("");
      try {
        const response = await fetch("/api/agent/models", { cache: "no-store" });
        const payload = await safeJson<{ models?: AgentModel[]; error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || "Failed to load models");
        if (cancelled) return;
        const nextModels = payload.models ?? [];
        setModels(nextModels);
        setSelectedModel(
          (current) =>
            (current && nextModels.some((model) => model.id === current) ? current : "") ||
            nextModels.find((model) => model.active)?.id ||
            nextModels[0]?.id ||
            "",
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load models");
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run a browser command issued by the agent against the embedded webview.
  // In dev (iframe) we can only do limited operations because of cross-origin
  // restrictions; we surface a helpful error so the model can adapt.
  const runBrowserCommand = useCallback(
    async (
      verb: string,
      payload: Record<string, unknown>,
    ): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
      const webview = getWebview();
      if (isElectron && webview && typeof webview.executeJavaScript === "function") {
        try {
          switch (verb) {
            case "navigate": {
              const url = sanitizeEmbeddedBrowserUrl(String(payload.url || ""));
              if (!url) return { ok: false, error: "valid http(s) url required" };
              await withBrowserTimeout(webview.loadURL(url), "Browser navigation");
              setBrowserUrl(url);
              setBrowserInput(url);
              return { ok: true, data: { url } };
            }
            case "get-url": {
              return { ok: true, data: { url: webview.getURL(), title: webview.getTitle() } };
            }
            case "get-text": {
              const text = (await withBrowserTimeout(
                webview.executeJavaScript("document.body && document.body.innerText"),
                "Browser text read",
              )) as string | null;
              const protectionError = detectBotProtection(text ?? "");
              if (protectionError) return { ok: false, error: protectionError };
              return { ok: true, data: { text: text ?? "" } };
            }
            case "get-html": {
              const html = (await withBrowserTimeout(
                webview.executeJavaScript(
                  "document.documentElement && document.documentElement.outerHTML",
                ),
                "Browser HTML read",
              )) as string | null;
              const protectionError = detectBotProtection(html ?? "");
              if (protectionError) return { ok: false, error: protectionError };
              return { ok: true, data: { html: html ?? "" } };
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
              const result = (await withBrowserTimeout(
                webview.executeJavaScript(script, true),
                "Browser click",
              )) as { found: boolean };
              return {
                ok: result.found,
                data: result,
                error: result.found ? undefined : "selector not found",
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
              return {
                ok: true,
                data: {
                  deltaY,
                  scrollY: await withBrowserTimeout(
                    webview.executeJavaScript("window.scrollY"),
                    "Browser scroll position read",
                  ),
                },
              };
            }
            case "fill": {
              const selector = String(payload.selector || "");
              const value = String(payload.value ?? "");
              if (!selector) return { ok: false, error: "selector required" };
              if (!isSafeBrowserSelector(selector)) {
                return { ok: false, error: "unsupported selector" };
              }
              const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { found: true }; })()`;
              const result = (await withBrowserTimeout(
                webview.executeJavaScript(script, true),
                "Browser fill",
              )) as { found: boolean };
              return {
                ok: result.found,
                data: result,
                error: result.found ? undefined : "selector not found",
              };
            }
            default:
              return { ok: false, error: `Unsupported browser verb: ${verb}` };
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      // Iframe fallback (dev or non-electron). Cross-origin restrictions make
      // most operations impossible — handle the few that are still useful.
      const iframe = getIframe();
      if (!iframe) return { ok: false, error: "Browser panel not mounted" };
      switch (verb) {
        case "navigate": {
          const url = sanitizeEmbeddedBrowserUrl(String(payload.url || ""));
          if (!url) return { ok: false, error: "valid http(s) url required" };
          iframe.src = url;
          setBrowserUrl(url);
          setBrowserInput(url);
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
    },
    [isElectron],
  );

  // Open an SSE subscription to /api/agent/browser/events whenever the
  // browser tool is enabled. Each command we receive is dispatched to
  // runBrowserCommand and the result is POSTed back to /result. The renderer
  // is the only authoritative source for the embedded webview state.
  useEffect(() => {
    if (!browserToolEnabled) return;
    if (typeof window === "undefined") return;
    const source = new EventSource("/api/agent/browser/events");
    source.onmessage = async (event) => {
      try {
        const command = JSON.parse(event.data) as {
          id: string;
          verb: string;
          payload: Record<string, unknown>;
        };
        const result = await runBrowserCommand(command.verb, command.payload);
        await fetch("/api/agent/browser/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: command.id, ...result }),
        });
      } catch (err) {
        // Swallow — pi will time out and surface the error to the model.
        console.warn("[agent] browser bridge dispatch failed", err);
      }
    };
    return () => {
      source.close();
    };
  }, [browserToolEnabled, runBrowserCommand]);

  // Restore preferences across reloads (browser-tool toggle, right-pane split ratio,
  // multiplex layout shape).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sessionsCollapsedCleaned = window.localStorage.getItem(
      "vllm-studio.agent.sessionsCollapsedCleaned",
    );
    if (!sessionsCollapsedCleaned) {
      window.localStorage.removeItem("vllm-studio.agent.sessionsCollapsed");
      window.localStorage.setItem("vllm-studio.agent.sessionsCollapsedCleaned", "1");
    }
    // One-time migration: reset stale ON state so the browser tool defaults
    // to OFF for existing users. New users naturally default to OFF.
    const migrated = window.localStorage.getItem(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY);
    if (!migrated) {
      window.localStorage.setItem(BROWSER_TOOL_KEY, "0");
      window.localStorage.setItem(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
    }
    const browserOn = window.localStorage.getItem(BROWSER_TOOL_KEY);
    if (browserOn === "1") setBrowserToolEnabled(true);
    const computerMigrated = window.localStorage.getItem(COMPUTER_DEFAULT_CLOSED_MIGRATION_KEY);
    if (!computerMigrated) {
      window.localStorage.setItem(COMPUTER_BROWSER_OPEN_KEY, "1");
      window.localStorage.setItem(COMPUTER_FILES_OPEN_KEY, "0");
      window.localStorage.setItem(COMPUTER_DEFAULT_CLOSED_MIGRATION_KEY, "1");
    }
    const filesOpenStored = window.localStorage.getItem(COMPUTER_FILES_OPEN_KEY);
    setActiveComputerTab(filesOpenStored === "1" ? "files" : "browser");
    setRightPanelOpen(window.localStorage.getItem(COMPUTER_BROWSER_OPEN_KEY) !== "0");
    const storedComputerWidth = Number(window.localStorage.getItem(COMPUTER_WIDTH_KEY));
    if (Number.isFinite(storedComputerWidth)) {
      setComputerWidth(clampComputerWidth(storedComputerWidth));
    }
    // Restore the pane layout shape only (split ratios + leaf placement). Each
    // referenced pane gets a fresh PaneState — we don't persist tab content
    // because pi sessions live in their own files and are picked from the
    // left sidebar URL navigation after restore.
    try {
      const raw = window.localStorage.getItem(PANE_LAYOUT_KEY);
      if (!raw) return;
      const restored = JSON.parse(raw) as Layout;
      if (!restored || typeof restored !== "object") return;
      const leaves = collectLeaves(restored);
      if (leaves.length === 0) return;
      const next = new Map<PaneId, PaneState>();
      for (const id of leaves) {
        const tab = makeFreshTab();
        next.set(id, {
          tabs: [tab],
          activeTabId: tab.id,
          runtimeSessionId: newRuntimeId(),
        });
      }
      setPanesById(next);
      setLayout(restored);
      setFocusedPaneId(leaves[0]);
    } catch {
      // ignore — fresh state
    }
  }, []);

  // Persist layout shape whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // ignore quota errors
    }
  }, [layout]);

  const selectComputerTab = useCallback((tab: ComputerTab) => {
    setActiveComputerTab(tab);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COMPUTER_BROWSER_OPEN_KEY, "1");
      window.localStorage.setItem(COMPUTER_FILES_OPEN_KEY, tab === "files" ? "1" : "0");
    }
  }, []);

  const toggleBrowserTool = useCallback(() => {
    setBrowserToolEnabled((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(BROWSER_TOOL_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  const notifySessionsChanged = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    window.setTimeout(() => window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT)), 1_500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshProjects = async () => {
      try {
        const list = await loadAgentProjects();
        if (cancelled) return;
        setProjects(list);
        setProjectsLoaded(true);
        const stored =
          typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_KEY) : null;
        const initial = (stored && list.find((entry) => entry.id === stored)) || list[0];
        if (initial) {
          setSelectedProjectId(initial.id);
          setAgentCwd(initial.path);
        } else {
          setSelectedProjectId(null);
          setAgentCwd(DEFAULT_AGENT_CWD);
        }
      } catch (err) {
        if (!cancelled) {
          setProjectsLoaded(true);
          console.warn("[agent] failed to load projects", err);
        }
      }
    };
    void refreshProjects();
    if (typeof window !== "undefined") {
      window.addEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
      }
    };
  }, []);

  const persistSelectedProjectId = useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
    } else {
      window.localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  }, []);

  const selectProject = useCallback(
    (project: ProjectEntry) => {
      setSelectedProjectId(project.id);
      setAgentCwd(project.path);
      persistSelectedProjectId(project.id);
      // A different project has its own session pool — reset every pane to a
      // fresh tab so the next turn starts a brand-new pi session in the new
      // project. Each pane keeps its runtimeSessionId so the pi child gets
      // a clean restart on the next /api/agent/turn.
      setPanesById((current) => {
        const next = new Map<PaneId, PaneState>();
        for (const [paneId, pane] of current.entries()) {
          const tab = makeFreshTab();
          next.set(paneId, {
            tabs: [tab],
            activeTabId: tab.id,
            runtimeSessionId: pane.runtimeSessionId,
          });
        }
        return next;
      });
    },
    [persistSelectedProjectId],
  );

  // Imperative session-management primitives. Every code path that opens a
  // new tab or replays a past session goes through these — no useEffect
  // chain, no `initialSessionId` field on PaneState. Read top-down to audit.

  // Idempotent "open a fresh chat tab in the focused pane". If the pane
  // already has an empty starter (no piSessionId, no messages, no input)
  // we focus that tab instead of stacking yet another empty one.
  const openNewSessionInFocusedPane = useCallback(() => {
    setPanesById((current) => {
      const cur = current.get(focusedPaneId);
      if (!cur) return current;
      const existing = cur.tabs.find(
        (tab) => !tab.piSessionId && tab.messages.length === 0 && !tab.input,
      );
      const next = new Map(current);
      if (existing) {
        next.set(focusedPaneId, { ...cur, activeTabId: existing.id });
        return next;
      }
      const tab = makeFreshTab();
      next.set(focusedPaneId, { ...cur, tabs: [...cur.tabs, tab], activeTabId: tab.id });
      return next;
    });
  }, [focusedPaneId]);

  // Replay a past pi session into the focused pane via the pane's
  // imperative handle. No race: the handle was registered when the pane
  // mounted; if it isn't ready yet the call is a no-op and the next click
  // will retry.
  const replaySessionInFocusedPane = useCallback(
    (piSessionId: string) => {
      queueSessionReplay(focusedPaneId, piSessionId);
    },
    [focusedPaneId, queueSessionReplay],
  );

  // Open a past session in a side-by-side pane. Splits the layout if there
  // isn't already a second pane, then queues the replay against that pane —
  // the queue drains as soon as the new ChatPane registers its handle.
  const replaySessionInSplitPane = useCallback(
    (piSessionId: string) => {
      const leaves = collectLeaves(layout);
      if (leaves.length >= 2) {
        const targetPaneId = leaves.find((id) => id !== focusedPaneId) ?? focusedPaneId;
        setFocusedPaneId(targetPaneId);
        queueSessionReplay(targetPaneId, piSessionId);
        return;
      }
      const id = newPaneId();
      const baseTab = makeFreshTab();
      setPanesById((current) => {
        const next = new Map(current);
        next.set(id, {
          tabs: [baseTab],
          activeTabId: baseTab.id,
          runtimeSessionId: newRuntimeId(),
        });
        return next;
      });
      setLayout((prev) => splitLeaf(prev, focusedPaneId, id, "vertical", "b"));
      setFocusedPaneId(id);
      queueSessionReplay(id, piSessionId);
    },
    [focusedPaneId, layout, queueSessionReplay],
  );

  // Single source of truth for URL nav. Re-run only when the URL string
  // changes; the ref guard makes it idempotent.
  const handledNavRef = useRef<string>("");
  useEffect(() => {
    if (!searchParams) return;
    const projectParam = searchParams.get("project");
    const sessionParam = searchParams.get("session");
    const newParam = searchParams.get("new");
    const splitParam = searchParams.get("split");
    if (!projectParam && !sessionParam && !newParam) return;
    const key = `${projectParam ?? ""}|${sessionParam ?? ""}|${newParam ?? ""}|${splitParam ?? ""}`;
    if (handledNavRef.current === key) return;

    if (projectParam) {
      const target = projects.find((entry) => entry.id === projectParam);
      if (!target) return; // wait for projects to load
      if (selectedProjectId !== target.id) selectProject(target);
    }
    handledNavRef.current = key;

    if (newParam === "1" && !sessionParam) {
      openNewSessionInFocusedPane();
      return;
    }
    if (sessionParam && splitParam === "1") {
      replaySessionInSplitPane(sessionParam);
      return;
    }
    if (sessionParam) {
      replaySessionInFocusedPane(sessionParam);
    }
  }, [
    searchParams,
    projects,
    selectedProjectId,
    selectProject,
    openNewSessionInFocusedPane,
    replaySessionInFocusedPane,
    replaySessionInSplitPane,
  ]);

  function normalizeBrowserInput(raw: string): string {
    const value = raw.trim();
    if (!value) return "https://www.google.com";
    if (/^file:\/\//i.test(value)) {
      try {
        return new URL(value).toString();
      } catch {
        return value;
      }
    }
    if (value.startsWith("~/") && agentCwd) {
      const expanded = expandHomeFilePath(agentCwd, value);
      if (expanded) return encodeFilePath(expanded);
    }
    if (value.startsWith("/")) return encodeFilePath(value);
    if ((value.startsWith("./") || value.startsWith("../")) && agentCwd) {
      return encodeFilePath(resolveRelativeFilePath(agentCwd, value));
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
    if (value.includes("/") && agentCwd) {
      return encodeFilePath(resolveRelativeFilePath(agentCwd, value));
    }
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  function submitBrowserUrl(event: FormEvent) {
    event.preventDefault();
    const next = normalizeBrowserInput(browserInput);
    if (!next) return;
    setBrowserInput(next);
    setBrowserUrl(next);
  }

  function startComputerResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = computerWidth;
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
      setComputerWidth(next);
      window.localStorage.setItem(COMPUTER_WIDTH_KEY, String(next));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const activeProject = useMemo(
    () => projects.find((entry) => entry.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const focusedPane = panesById.get(focusedPaneId) ?? panesById.values().next().value ?? null;
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const focusedProject =
    projects.find((entry) => entry.id === focusedTab?.projectId) ??
    projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;

  const refreshGitSummary = useCallback(async () => {
    if (!focusedProject?.path) {
      setGitSummary(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/agent/git-diff?cwd=${encodeURIComponent(focusedProject.path)}`,
        { cache: "no-store" },
      );
      const payload = (await safeJson<{
        isRepo?: boolean;
        branch?: string | null;
        additions?: number;
        deletions?: number;
        status?: string[];
      }>(response)) as {
        isRepo?: boolean;
        branch?: string | null;
        additions?: number;
        deletions?: number;
        status?: string[];
      };
      setGitSummary({
        isRepo: payload.isRepo === true,
        branch: payload.branch ?? null,
        additions: payload.additions ?? 0,
        deletions: payload.deletions ?? 0,
        statusCount: payload.status?.length ?? 0,
      });
    } catch {
      setGitSummary(null);
    }
  }, [focusedProject?.path]);

  useEffect(() => {
    void refreshGitSummary();
  }, [refreshGitSummary]);

  const initGitForActiveProject = useCallback(async () => {
    if (!focusedProject?.path) return;
    const response = await fetch(
      `/api/agent/git-diff?cwd=${encodeURIComponent(focusedProject.path)}`,
      { method: "POST" },
    );
    if (!response.ok) {
      const payload = await safeJson<{ error?: string }>(response);
      setError(payload.error || "Failed to initialize git repository");
      return;
    }
    await refreshGitSummary();
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  }, [focusedProject?.path, refreshGitSummary]);

  const focusedTabIsNew =
    Boolean(focusedTab) && !focusedTab?.piSessionId && (focusedTab?.messages.length ?? 0) === 0;
  const shouldShowProjectEmptyState =
    projectsLoaded && !searchParams.get("project") && !selectedProjectId && projects.length === 0;

  // Broadcast the set of *real* in-flight sessions (i.e. tabs that have
  // either been assigned a pi UUID or already contain user messages) to the
  // navbar. Empty starter tabs are intentionally excluded so the navbar
  // doesn't list them as "sessions".
  useEffect(() => {
    if (typeof window === "undefined" || !activeProject) return;
    const sessions = [...panesById.entries()].flatMap(([paneId, pane]) =>
      pane.tabs
        .filter((tab) => Boolean(tab.piSessionId) || tab.messages.length > 0)
        .map((tab) => {
          const project =
            projects.find((entry) => entry.id === tab.projectId) ??
            projects.find((entry) => entry.path === tab.cwd) ??
            activeProject;
          return {
            projectId: project.id,
            cwd: tab.cwd ?? project.path,
            paneId,
            tabId: tab.id,
            piSessionId: tab.piSessionId,
            title: tab.title,
            status: tab.status,
            updatedAt: new Date().toISOString(),
          };
        }),
    );
    window.dispatchEvent(new CustomEvent(ACTIVE_AGENT_SESSIONS_EVENT, { detail: { sessions } }));
  }, [activeProject, panesById, projects]);

  const openSessionPayloadInPane = useCallback(
    (paneId: PaneId, payload: SessionDropPayload) => {
      let needsReplay = false;
      setPanesById((current) => {
        const target = current.get(paneId);
        if (!target) return current;
        const next = new Map(current);
        if (payload.piSessionId) {
          const tab = {
            ...makeFreshTab(),
            projectId: payload.projectId,
            cwd: payload.cwd,
            title: payload.title ?? "Loading session",
          };
          next.set(paneId, {
            ...target,
            tabs: [...target.tabs, tab],
            activeTabId: tab.id,
          });
          needsReplay = true;
          return next;
        }
        if (payload.paneId && payload.tabId) {
          const source = current.get(payload.paneId);
          const sourceTab = source?.tabs.find((tab) => tab.id === payload.tabId);
          if (!sourceTab) return current;
          const fresh = makeFreshTab();
          const tab = {
            ...sourceTab,
            id: fresh.id,
            runtimeSessionId: fresh.runtimeSessionId,
          };
          next.set(paneId, { ...target, tabs: [...target.tabs, tab], activeTabId: tab.id });
        }
        return next;
      });
      setFocusedPaneId(paneId);
      if (needsReplay && payload.piSessionId) {
        queueSessionReplay(paneId, payload.piSessionId);
      }
    },
    [queueSessionReplay],
  );

  // Imperative tab actions used by both URL nav and DOM-event listeners.
  const renameTab = useCallback((paneId: PaneId, tabId: string, title: string) => {
    setPanesById((current) => {
      const pane = current.get(paneId);
      if (!pane) return current;
      const next = new Map(current);
      next.set(paneId, {
        ...pane,
        tabs: pane.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
      });
      return next;
    });
  }, []);

  const focusTab = useCallback((paneId: PaneId, tabId: string) => {
    setFocusedPaneId(paneId);
    setPanesById((current) => {
      const pane = current.get(paneId);
      if (!pane) return current;
      const next = new Map(current);
      next.set(paneId, { ...pane, activeTabId: tabId });
      return next;
    });
  }, []);

  const splitTabIntoNewPane = useCallback(
    (sourcePaneId: PaneId, sourceTabId: string) => {
      const leaves = collectLeaves(layout);
      const source = panesById.get(sourcePaneId);
      const sourceTab = source?.tabs.find((tab) => tab.id === sourceTabId);
      const fresh = makeFreshTab();
      const tab = sourceTab
        ? { ...sourceTab, id: fresh.id, runtimeSessionId: fresh.runtimeSessionId }
        : fresh;
      if (leaves.length >= 2) {
        const targetPaneId = leaves.find((leafId) => leafId !== focusedPaneId) ?? focusedPaneId;
        setPanesById((current) => {
          const target = current.get(targetPaneId);
          if (!target) return current;
          const next = new Map(current);
          next.set(targetPaneId, {
            ...target,
            tabs: [...target.tabs, tab],
            activeTabId: tab.id,
          });
          return next;
        });
        setFocusedPaneId(targetPaneId);
        return;
      }
      const id = newPaneId();
      setPanesById((current) => {
        const next = new Map(current);
        next.set(id, { tabs: [tab], activeTabId: tab.id, runtimeSessionId: newRuntimeId() });
        return next;
      });
      setLayout((prev) => splitLeaf(prev, focusedPaneId, id, "vertical", "b"));
      setFocusedPaneId(id);
    },
    [focusedPaneId, layout, panesById],
  );

  // Bridge from window events (dispatched by the navbar) to the imperative
  // helpers above. We use a ref so listeners stay mount-only — this is the
  // only effect for the navbar event API and its handler is trivially
  // auditable in one spot.
  const navHandlersRef = useRef({
    openNewSessionInFocusedPane,
    renameTab,
    focusTab,
    splitTabIntoNewPane,
    selectProject,
    selectedProjectId,
    projects,
  });
  navHandlersRef.current = {
    openNewSessionInFocusedPane,
    renameTab,
    focusTab,
    splitTabIntoNewPane,
    selectProject,
    selectedProjectId,
    projects,
  };
  useEffect(() => {
    const onNewSession = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      const h = navHandlersRef.current;
      if (detail?.projectId) {
        const target = h.projects.find((entry) => entry.id === detail.projectId);
        if (target && h.selectedProjectId !== target.id) {
          h.selectProject(target);
          return;
        }
      }
      h.openNewSessionInFocusedPane();
    };
    const onRename = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: PaneId; tabId?: string; title?: string }>)
        .detail;
      if (!detail?.paneId || !detail.tabId || !detail.title) return;
      navHandlersRef.current.renameTab(detail.paneId, detail.tabId, detail.title);
    };
    const onOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{ paneId?: PaneId; tabId?: string; mode?: "focus" | "split" }>
      ).detail;
      if (!detail?.paneId || !detail.tabId) return;
      if (detail.mode === "split") {
        navHandlersRef.current.splitTabIntoNewPane(detail.paneId, detail.tabId);
        return;
      }
      navHandlersRef.current.focusTab(detail.paneId, detail.tabId);
    };
    window.addEventListener(NEW_AGENT_SESSION_EVENT, onNewSession);
    window.addEventListener(ACTIVE_AGENT_SESSION_RENAME_EVENT, onRename);
    window.addEventListener(ACTIVE_AGENT_SESSION_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(NEW_AGENT_SESSION_EVENT, onNewSession);
      window.removeEventListener(ACTIVE_AGENT_SESSION_RENAME_EVENT, onRename);
      window.removeEventListener(ACTIVE_AGENT_SESSION_OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--bg) text-(--fg) md:h-[100dvh]">
      {error ? (
        <div className="border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() =>
              setRightPanelOpen((value) => {
                const next = !value;
                window.localStorage.setItem(COMPUTER_BROWSER_OPEN_KEY, next ? "1" : "0");
                return next;
              })
            }
            aria-pressed={rightPanelOpen}
            className={`absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md border backdrop-blur ${
              rightPanelOpen
                ? "border-(--accent)/50 bg-(--accent)/10 text-(--accent)"
                : "border-(--border) bg-(--surface)/90 text-(--dim) hover:text-(--fg)"
            }`}
            title={rightPanelOpen ? "Hide computer" : "Show computer"}
            aria-label={rightPanelOpen ? "Hide computer" : "Show computer"}
          >
            <ComputerIcon className="h-4 w-4" />
          </button>
          {shouldShowProjectEmptyState ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <div className="max-w-sm text-center">
                <div className="text-sm font-semibold text-(--fg)">
                  Add a project to get started
                </div>
                <p className="mt-2 text-xs leading-5 text-(--dim)">
                  Choose a local folder so the agent can scope files and sessions to your work.
                </p>
                <button
                  type="button"
                  onClick={triggerAddProjectFlow}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded border border-(--border) bg-(--surface) px-3 text-sm font-medium text-(--fg) hover:bg-(--bg)"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add a project
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <PaneGrid
                layout={layout}
                renderPane={(paneId) => {
                  const pane = panesById.get(paneId);
                  if (!pane) return null;
                  const onlyOne = collectLeaves(layout).length === 1;
                  const paneActiveTab =
                    pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0] ?? null;
                  const paneProject =
                    projects.find((project) => project.id === paneActiveTab?.projectId) ??
                    projects.find((project) => project.path === paneActiveTab?.cwd) ??
                    activeProject;
                  const paneCwd = paneActiveTab?.cwd ?? paneProject?.path ?? agentCwd;
                  const paneModelId = paneActiveTab?.modelId ?? selectedModel;
                  const paneModel = models.find((model) => model.id === paneModelId) ?? null;
                  const paneTabIsNew =
                    Boolean(paneActiveTab) &&
                    !paneActiveTab?.piSessionId &&
                    (paneActiveTab?.messages.length ?? 0) === 0;
                  return (
                    <ChatPane
                      key={paneId}
                      paneId={paneId}
                      runtimeSessionId={pane.runtimeSessionId}
                      modelId={paneModelId}
                      modelName={paneModel?.name ?? null}
                      modelsLoading={loadingModels}
                      contextWindow={paneModel?.contextWindow ?? 0}
                      cwd={paneCwd}
                      projectName={paneProject?.name ?? null}
                      projectSelector={
                        paneProject && projects.length > 0 ? (
                          <select
                            value={paneProject.id}
                            onChange={(event) => {
                              const project = projects.find(
                                (entry) => entry.id === event.target.value,
                              );
                              if (!project) return;
                              setPanesById((current) => {
                                const cur = current.get(paneId);
                                if (!cur) return current;
                                const next = new Map(current);
                                next.set(paneId, {
                                  ...cur,
                                  tabs: cur.tabs.map((tab) =>
                                    tab.id === cur.activeTabId
                                      ? { ...tab, projectId: project.id, cwd: project.path }
                                      : tab,
                                  ),
                                });
                                return next;
                              });
                            }}
                            disabled={!paneTabIsNew}
                            className="min-w-0 max-w-[280px] truncate rounded border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[11px] text-(--dim) outline-none hover:text-(--fg) disabled:opacity-100"
                            title={
                              paneTabIsNew
                                ? "Change directory for this new session"
                                : paneProject.path
                            }
                            aria-label="Session directory"
                          >
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.path}
                              </option>
                            ))}
                          </select>
                        ) : null
                      }
                      gitBranch={gitSummary?.branch ?? paneProject?.branch ?? null}
                      gitSummary={gitSummary}
                      onInitGit={initGitForActiveProject}
                      modelSelector={
                        <ModelPicker
                          models={models}
                          selectedModel={paneModelId}
                          onSelect={(modelId) => {
                            setPanesById((current) => {
                              const cur = current.get(paneId);
                              if (!cur) return current;
                              const next = new Map(current);
                              next.set(paneId, {
                                ...cur,
                                tabs: cur.tabs.map((tab) =>
                                  tab.id === cur.activeTabId ? { ...tab, modelId } : tab,
                                ),
                              });
                              return next;
                            });
                          }}
                          loading={loadingModels}
                        />
                      }
                      browserToolEnabled={focusedPaneId === paneId && browserToolEnabled}
                      onToggleBrowserTool={toggleBrowserTool}
                      onPiSessionIdChange={notifySessionsChanged}
                      isFocused={focusedPaneId === paneId}
                      onFocus={() => setFocusedPaneId(paneId)}
                      tabs={pane.tabs}
                      activeTabId={pane.activeTabId}
                      onTabsChange={(nextTabsOrUpdater) => {
                        setPanesById((current) => {
                          const cur = current.get(paneId);
                          if (!cur) return current;
                          const nextTabs =
                            typeof nextTabsOrUpdater === "function"
                              ? nextTabsOrUpdater(cur.tabs)
                              : nextTabsOrUpdater;
                          const next = new Map(current);
                          next.set(paneId, { ...cur, tabs: nextTabs });
                          return next;
                        });
                      }}
                      onClose={
                        onlyOne
                          ? undefined
                          : () => {
                              setLayout((prev) => removeLeaf(prev, paneId) ?? prev);
                              setPanesById((current) => {
                                const next = new Map(current);
                                next.delete(paneId);
                                return next;
                              });
                              if (focusedPaneId === paneId) {
                                const remaining = collectLeaves(layout).filter(
                                  (id) => id !== paneId,
                                );
                                if (remaining[0]) setFocusedPaneId(remaining[0]);
                              }
                            }
                      }
                      onRegisterHandle={(handle) => registerPaneHandle(paneId, handle)}
                    />
                  );
                }}
                onSplit={(paneId, direction, side, payload) => {
                  // Create a new pane next to the drop target.
                  const id = newPaneId();
                  if (collectLeaves(layout).length >= 2) return;
                  const runtime = newRuntimeId();
                  const baseTab = {
                    ...makeFreshTab(),
                    projectId: payload.projectId,
                    cwd: payload.cwd,
                    title: payload.title ?? "Loading session",
                  };
                  setPanesById((current) => {
                    const next = new Map(current);
                    next.set(id, {
                      tabs: [baseTab],
                      activeTabId: baseTab.id,
                      runtimeSessionId: runtime,
                    });
                    if (!payload.piSessionId && payload.paneId && payload.tabId) {
                      const source = current.get(payload.paneId);
                      const sourceTab = source?.tabs.find((tab) => tab.id === payload.tabId);
                      if (sourceTab) {
                        next.set(id, {
                          tabs: [
                            {
                              ...sourceTab,
                              id: baseTab.id,
                              runtimeSessionId: baseTab.runtimeSessionId,
                            },
                          ],
                          activeTabId: baseTab.id,
                          runtimeSessionId: runtime,
                        });
                      }
                    }
                    return next;
                  });
                  setLayout((prev) => splitLeaf(prev, paneId, id, direction, side));
                  setFocusedPaneId(id);
                  if (payload.piSessionId) queueSessionReplay(id, payload.piSessionId);
                }}
                onOpenTab={openSessionPayloadInPane}
                onResize={(path, ratio) => {
                  setLayout((prev) => setSplitRatio(prev, path, ratio));
                }}
              />
            </div>
          )}
        </section>

        {rightPanelOpen ? (
          <aside
            className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
            ref={computerAsideRef}
            style={{ width: `min(${computerWidth}px, 48vw)` }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              title="Resize computer"
              onMouseDown={startComputerResize}
              className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
            />
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-(--border) px-2 text-xs text-(--dim)">
              <span
                className="min-w-0 flex-1 truncate px-1 text-[10px] uppercase tracking-wide"
                title={`Computer follows focused session: ${focusedTab?.title ?? "New session"}`}
              >
                {focusedTab?.title ?? "Focused session"}
              </span>
              <button
                type="button"
                onClick={() => selectComputerTab("browser")}
                className={`h-6 shrink-0 rounded px-2 font-medium uppercase tracking-wide ${
                  activeComputerTab === "browser"
                    ? "bg-(--surface) text-(--fg)"
                    : "hover:bg-(--surface) hover:text-(--fg)"
                }`}
              >
                Browser
              </button>
              <button
                type="button"
                onClick={() => selectComputerTab("files")}
                className={`h-6 shrink-0 rounded px-2 font-medium uppercase tracking-wide ${
                  activeComputerTab === "files"
                    ? "bg-(--surface) text-(--fg)"
                    : "hover:bg-(--surface) hover:text-(--fg)"
                }`}
              >
                Files
              </button>
              <button
                type="button"
                onClick={() => selectComputerTab("diff")}
                className={`h-6 shrink-0 rounded px-2 font-medium uppercase tracking-wide ${
                  activeComputerTab === "diff"
                    ? "bg-(--surface) text-(--fg)"
                    : "hover:bg-(--surface) hover:text-(--fg)"
                }`}
              >
                Diff
              </button>
              <button
                type="button"
                onClick={() => {
                  setRightPanelOpen(false);
                  window.localStorage.setItem(COMPUTER_BROWSER_OPEN_KEY, "0");
                }}
                className="ml-1 rounded p-1 hover:bg-(--surface) hover:text-(--fg)"
                title="Close"
                aria-label="Close computer"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>

            {activeComputerTab === "browser" ? (
              <AgentBrowser
                ref={browserRef}
                url={browserUrl}
                inputValue={browserInput}
                onInputChange={setBrowserInput}
                onSubmit={submitBrowserUrl}
                onClose={() => setRightPanelOpen(false)}
                isElectron={isElectron}
              />
            ) : activeComputerTab === "files" ? (
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1">
                  <FilesystemPanel cwd={activeProject?.path ?? null} />
                </div>
              </section>
            ) : (
              <GitDiffPanel cwd={activeProject?.path ?? null} />
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ModelPicker({
  models,
  selectedModel,
  onSelect,
  loading,
}: {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = models.find((model) => model.id === selectedModel) || null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const triggerLabel = loading
    ? "Loading…"
    : active?.name || (models.length === 0 ? "No models" : "Select model");
  const disabled = loading || models.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((value) => !value);
        }}
        disabled={disabled}
        className="inline-flex h-7 items-center gap-1.5 rounded border border-(--border) bg-(--surface) px-2 text-xs text-(--fg) hover:bg-(--bg) disabled:opacity-60"
        title={active?.name || triggerLabel}
      >
        <span className="max-w-[160px] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-50 w-72 rounded-md border border-(--border) bg-(--surface) shadow-lg">
          <div className="max-h-72 overflow-y-auto p-1">
            {models.map((model) => {
              const isActive = model.id === selectedModel;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelect(model.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-(--bg) ${
                    isActive ? "bg-(--bg)" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-(--fg)">
                    {model.name}
                  </span>
                  {model.reasoning ? (
                    <span className="shrink-0 text-[10px] text-(--dim)">· reasoning</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
