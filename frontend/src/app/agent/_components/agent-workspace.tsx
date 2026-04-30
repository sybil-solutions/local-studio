"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cpu,
  Folder,
  GitBranch,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ChatPane, makeFreshTab, type SessionTab } from "./chat-pane";
import { FilesystemPanel } from "./filesystem-panel";
import { PaneGrid } from "./pane-grid";
import {
  collectLeaves,
  removeLeaf,
  setSplitRatio,
  splitLeaf,
  type Layout,
  type PaneId,
} from "./pane-layout";
import { SessionsSidebar } from "./sessions-sidebar";

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  src: string;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  getTitle: () => string;
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  capturePage: () => Promise<{ toDataURL: () => string }>;
  addEventListener: HTMLElement["addEventListener"];
  removeEventListener: HTMLElement["removeEventListener"];
};

type AgentModel = {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
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

type DesktopBridge = {
  openDirectory: () => Promise<ProjectEntry | null>;
  listProjects: () => Promise<ProjectEntry[]>;
  addProject: (directoryPath: string) => Promise<ProjectEntry>;
  removeProject: (id: string) => Promise<{ ok: true }>;
};

const DEFAULT_AGENT_CWD = "";
const SELECTED_PROJECT_KEY = "vllm-studio.agent.selectedProjectId";
const SESSIONS_COLLAPSED_KEY = "vllm-studio.agent.sessionsCollapsed";
const BROWSER_TOOL_KEY = "vllm-studio.agent.browserToolEnabled";
const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "vllm-studio.agent.browserToolDefaultOffMigration.v1";
const COMPUTER_BROWSER_OPEN_KEY = "vllm-studio.agent.computer.browserOpen";
const COMPUTER_FILES_OPEN_KEY = "vllm-studio.agent.computer.filesOpen";
const PANE_LAYOUT_KEY = "vllm-studio.agent.paneLayout";

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { vllmStudioDesktop?: Partial<DesktopBridge> })
    .vllmStudioDesktop;
  if (!candidate) return null;
  if (
    typeof candidate.openDirectory !== "function" ||
    typeof candidate.listProjects !== "function" ||
    typeof candidate.addProject !== "function" ||
    typeof candidate.removeProject !== "function"
  ) {
    return null;
  }
  return candidate as DesktopBridge;
}

function newPaneId(): PaneId {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function newRuntimeId(): string {
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerInput, setProjectPickerInput] = useState("");
  const [projectPickerError, setProjectPickerError] = useState("");
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [browserToolEnabled, setBrowserToolEnabled] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  // Pane state: a tree-shaped Layout where each leaf is identified by a
  // PaneId and points into panesById, which holds tabs + the per-pane
  // runtime session id used to scope the pi child process and the
  // /api/agent/turn calls. Each tab inside a pane has its own piSessionId
  // (loaded from the sidebar or assigned by pi after the first turn).
  const [layout, setLayout] = useState<Layout>(() => ({ kind: "leaf", paneId: "p-init" }));
  const [panesById, setPanesById] = useState<Map<PaneId, PaneState>>(() => {
    const tab = makeFreshTab();
    return new Map([
      [
        "p-init",
        {
          tabs: [tab],
          activeTabId: tab.id,
          runtimeSessionId: `rt-${Math.random().toString(36).slice(2, 9)}`,
        },
      ],
    ]);
  });
  const [focusedPaneId, setFocusedPaneId] = useState<PaneId>("p-init");

  const webviewRef = useRef<WebviewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isElectron = typeof window !== "undefined" && /electron/i.test(navigator.userAgent);
  const desktopBridge = useMemo<DesktopBridge | null>(() => getDesktopBridge(), []);

  const activeModel = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel],
  );

  // The focused tab's piSessionId drives the sessions sidebar highlight.
  const focusedPiSessionId = useMemo(() => {
    const pane = panesById.get(focusedPaneId);
    if (!pane) return null;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    return tab?.piSessionId ?? null;
  }, [panesById, focusedPaneId]);

  // Map of paneId → loader callback registered by each ChatPane on mount, so
  // the workspace can request a session replay (sidebar click or split-drop).
  const paneLoadersRef = useRef<Map<PaneId, (piSessionId: string) => void>>(new Map());
  const registerPaneLoader = useCallback(
    (paneId: PaneId, loader: (piSessionId: string) => void) => {
      paneLoadersRef.current.set(paneId, loader);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      setLoadingModels(true);
      setError("");
      try {
        const response = await fetch("/api/agent/models", { cache: "no-store" });
        const payload = (await response.json()) as { models?: AgentModel[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Failed to load models");
        if (cancelled) return;
        const nextModels = payload.models ?? [];
        setModels(nextModels);
        setSelectedModel((current) => current || nextModels[0]?.id || "");
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
    async (verb: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
      const webview = webviewRef.current;
      if (isElectron && webview && typeof webview.executeJavaScript === "function") {
        try {
          switch (verb) {
            case "navigate": {
              const url = String(payload.url || "");
              if (!url) return { ok: false, error: "url required" };
              await webview.loadURL(url);
              setBrowserUrl(url);
              setBrowserInput(url);
              return { ok: true, data: { url } };
            }
            case "get-url": {
              return { ok: true, data: { url: webview.getURL(), title: webview.getTitle() } };
            }
            case "get-text": {
              const text = (await webview.executeJavaScript("document.body && document.body.innerText")) as string | null;
              return { ok: true, data: { text: text ?? "" } };
            }
            case "get-html": {
              const html = (await webview.executeJavaScript("document.documentElement && document.documentElement.outerHTML")) as string | null;
              return { ok: true, data: { html: html ?? "" } };
            }
            case "screenshot": {
              const image = await webview.capturePage();
              return { ok: true, data: { dataUri: image.toDataURL() } };
            }
            case "click": {
              const selector = String(payload.selector || "");
              if (!selector) return { ok: false, error: "selector required" };
              const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; (el).click(); return { found: true }; })()`;
              const result = (await webview.executeJavaScript(script, true)) as { found: boolean };
              return { ok: result.found, data: result, error: result.found ? undefined : "selector not found" };
            }
            case "scroll": {
              const deltaY = Number(payload.deltaY ?? 0);
              await webview.executeJavaScript(`window.scrollBy(0, ${deltaY})`);
              return { ok: true, data: { deltaY, scrollY: await webview.executeJavaScript("window.scrollY") } };
            }
            case "fill": {
              const selector = String(payload.selector || "");
              const value = String(payload.value ?? "");
              const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { found: true }; })()`;
              const result = (await webview.executeJavaScript(script, true)) as { found: boolean };
              return { ok: result.found, data: result, error: result.found ? undefined : "selector not found" };
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
      const iframe = iframeRef.current;
      if (!iframe) return { ok: false, error: "Browser panel not mounted" };
      switch (verb) {
        case "navigate": {
          const url = String(payload.url || "");
          if (!url) return { ok: false, error: "url required" };
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
        const command = JSON.parse(event.data) as { id: string; verb: string; payload: Record<string, unknown> };
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

  // Restore preferences across reloads (sessions sidebar collapsed,
  // browser-tool toggle, right-pane split ratio, multiplex layout shape).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const collapsed = window.localStorage.getItem(SESSIONS_COLLAPSED_KEY);
    if (collapsed === "1") setSessionsCollapsed(true);
    // One-time migration: reset stale ON state so the browser tool defaults
    // to OFF for existing users. New users naturally default to OFF.
    const migrated = window.localStorage.getItem(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY);
    if (!migrated) {
      window.localStorage.setItem(BROWSER_TOOL_KEY, "0");
      window.localStorage.setItem(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
    }
    const browserOn = window.localStorage.getItem(BROWSER_TOOL_KEY);
    if (browserOn === "1") setBrowserToolEnabled(true);
    const browserOpenStored = window.localStorage.getItem(COMPUTER_BROWSER_OPEN_KEY);
    if (browserOpenStored === "0") setBrowserOpen(false);
    const filesOpenStored = window.localStorage.getItem(COMPUTER_FILES_OPEN_KEY);
    if (filesOpenStored === "0") setFilesOpen(false);
    // Restore the pane layout shape only (split ratios + leaf placement). Each
    // referenced pane gets a fresh PaneState — we don't persist tab content
    // because pi sessions live in their own files and are picked from the
    // sidebar after restore.
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

  const persistSessionsCollapsed = useCallback((value: boolean) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSIONS_COLLAPSED_KEY, value ? "1" : "0");
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

  const loadProjects = useCallback(async (): Promise<ProjectEntry[]> => {
    if (desktopBridge) {
      return desktopBridge.listProjects();
    }
    const response = await fetch("/api/agent/projects", { cache: "no-store" });
    const payload = (await response.json()) as { projects?: ProjectEntry[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Failed to load projects");
    return payload.projects ?? [];
  }, [desktopBridge]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadProjects();
        if (cancelled) return;
        setProjects(list);
        const stored =
          typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_PROJECT_KEY) : null;
        const initial = (stored && list.find((entry) => entry.id === stored)) || list[0];
        if (initial) {
          setSelectedProjectId(initial.id);
          setAgentCwd(initial.path);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[agent] failed to load projects", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

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

  const addProjectFromPath = useCallback(
    async (rawPath: string): Promise<ProjectEntry> => {
      if (desktopBridge) {
        return desktopBridge.addProject(rawPath);
      }
      const response = await fetch("/api/agent/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rawPath }),
      });
      const payload = (await response.json()) as { project?: ProjectEntry; error?: string };
      if (!response.ok || !payload.project) {
        throw new Error(payload.error || "Failed to add project");
      }
      return payload.project;
    },
    [desktopBridge],
  );

  const handleOpenProject = useCallback(async () => {
    setProjectPickerError("");
    if (desktopBridge) {
      try {
        const project = await desktopBridge.openDirectory();
        if (!project) return;
        const list = await loadProjects();
        setProjects(list);
        selectProject(project);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open directory");
      }
      return;
    }
    setProjectPickerInput("");
    setProjectPickerOpen(true);
  }, [desktopBridge, loadProjects, selectProject]);

  const submitProjectPicker = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const value = projectPickerInput.trim();
      if (!value) return;
      try {
        const project = await addProjectFromPath(value);
        const list = await loadProjects();
        setProjects(list);
        selectProject(project);
        setProjectPickerOpen(false);
        setProjectPickerInput("");
        setProjectPickerError("");
      } catch (err) {
        setProjectPickerError(err instanceof Error ? err.message : "Failed to add project");
      }
    },
    [addProjectFromPath, loadProjects, projectPickerInput, selectProject],
  );

  const removeProjectById = useCallback(
    async (id: string) => {
      try {
        if (desktopBridge) {
          await desktopBridge.removeProject(id);
        } else {
          const response = await fetch(`/api/agent/projects?id=${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(payload.error || "Failed to remove project");
          }
        }
        const list = await loadProjects();
        setProjects(list);
        if (selectedProjectId === id) {
          const next = list[0] ?? null;
          if (next) {
            selectProject(next);
          } else {
            setSelectedProjectId(null);
            persistSelectedProjectId(null);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove project");
      }
    },
    [desktopBridge, loadProjects, persistSelectedProjectId, selectProject, selectedProjectId],
  );

  const handleCwdInputChange = useCallback(
    (value: string) => {
      setAgentCwd(value);
      const match = projects.find((entry) => entry.path === value.trim().replace(/\/+$/, ""));
      if (match) {
        if (selectedProjectId !== match.id) {
          setSelectedProjectId(match.id);
          persistSelectedProjectId(match.id);
        }
      } else if (selectedProjectId !== null) {
        setSelectedProjectId(null);
        persistSelectedProjectId(null);
      }
    },
    [persistSelectedProjectId, projects, selectedProjectId],
  );


  function normalizeBrowserInput(raw: string): string {
    const value = raw.trim();
    if (!value) return "https://www.google.com";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(value) || /^localhost(:\d+)?/i.test(value)) {
      return `https://${value}`;
    }
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  function submitBrowserUrl(event: FormEvent) {
    event.preventDefault();
    const next = normalizeBrowserInput(browserInput);
    setBrowserInput(next);
    setBrowserUrl(next);
  }

  function browserBack() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goBack();
    }
  }

  function browserForward() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.goForward();
    }
  }

  function browserReload() {
    if (isElectron && webviewRef.current) {
      webviewRef.current.reload();
      return;
    }
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow?.location.reload();
      } catch {
        // Cross-origin reload via src reset
        const current = iframeRef.current.src;
        iframeRef.current.src = current;
      }
    }
  }

  // Open a fresh tab in the focused pane (same project, new pi session).
  const newThreadInFocusedPane = useCallback(() => {
    setPanesById((current) => {
      const pane = current.get(focusedPaneId);
      if (!pane) return current;
      const tab = makeFreshTab();
      const next = new Map(current);
      next.set(focusedPaneId, {
        ...pane,
        tabs: [...pane.tabs, tab],
        activeTabId: tab.id,
      });
      return next;
    });
    setError("");
  }, [focusedPaneId]);

  const activeProject = useMemo(
    () => projects.find((entry) => entry.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-0 w-full flex-col bg-(--bg) text-(--fg) md:h-[100dvh]">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-(--border) px-4">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-semibold tracking-tight">Agent</span>
          {activeProject ? (
            <span className="hidden items-center gap-1 truncate text-xs text-(--dim) sm:inline-flex">
              <span className="opacity-60">/</span>
              <span className="truncate">{activeProject.name}</span>
              {activeProject.hasGit && activeProject.branch ? (
                <span className="ml-1 inline-flex items-center gap-1 rounded border border-(--border) px-1 py-0.5 font-mono text-[10px]">
                  <GitBranch className="h-3 w-3" />
                  {activeProject.branch}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="flex-1" />

        <ProjectPicker
          projects={projects}
          activeId={selectedProjectId}
          onSelect={selectProject}
          onOpen={() => void handleOpenProject()}
          onRemove={(id) => void removeProjectById(id)}
          pickerOpen={projectPickerOpen}
          onPickerOpenChange={setProjectPickerOpen}
          pickerInput={projectPickerInput}
          onPickerInputChange={setProjectPickerInput}
          pickerError={projectPickerError}
          onPickerSubmit={submitProjectPicker}
          onPickerCancel={() => {
            setProjectPickerOpen(false);
            setProjectPickerInput("");
            setProjectPickerError("");
          }}
          cwd={agentCwd}
          onCwdChange={handleCwdInputChange}
          running={false}
        />

        <button
          type="button"
          onClick={newThreadInFocusedPane}
          className="inline-flex h-7 items-center gap-1.5 rounded border border-(--border) bg-(--surface) px-2 text-xs text-(--fg) hover:bg-(--bg)"
          title="Start a fresh thread in the focused pane"
        >
          <Plus className="h-3.5 w-3.5" /> New thread
        </button>

        <button
          type="button"
          onClick={() => setRightPanelOpen((value) => !value)}
          aria-pressed={rightPanelOpen}
          className={`hidden h-7 items-center gap-1.5 rounded border px-2 text-xs xl:inline-flex ${
            rightPanelOpen
              ? "border-(--border) bg-(--surface) text-(--fg)"
              : "border-transparent text-(--dim) hover:text-(--fg) hover:bg-(--surface)"
          }`}
          title="Toggle browser"
        >
          Browser
        </button>
      </header>

      {error ? (
        <div className="border-b border-(--border) bg-(--err)/10 px-4 py-2 text-xs text-(--err)">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <SessionsSidebar
          cwd={activeProject?.path ?? null}
          activeSessionId={focusedPiSessionId}
          onSelect={(id) => {
            // Hand the session id to the focused pane's registered loader,
            // which performs the GET /api/agent/sessions/:id replay into its
            // active tab.
            const loader = paneLoadersRef.current.get(focusedPaneId);
            if (!loader) return;
            loader(id);
          }}
          onNew={newThreadInFocusedPane}
          collapsed={sessionsCollapsed}
          onToggleCollapsed={() => {
            const next = !sessionsCollapsed;
            setSessionsCollapsed(next);
            persistSessionsCollapsed(next);
          }}
        />
        <section className="flex min-w-0 flex-1 flex-col">
          {!selectedProjectId && projects.length === 0 ? (
            <div className="shrink-0 border-b border-(--border) bg-(--surface) px-6 py-2 text-[11px] text-(--dim)">
              No project selected — agent runs in your home directory. Pick a project from the
              header to scope it.
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <PaneGrid
              layout={layout}
              renderPane={(paneId) => {
                const pane = panesById.get(paneId);
                if (!pane) return null;
                const onlyOne = collectLeaves(layout).length === 1;
                return (
                  <ChatPane
                    key={paneId}
                    paneId={paneId}
                    runtimeSessionId={pane.runtimeSessionId}
                    modelId={selectedModel}
                    modelName={activeModel?.name ?? null}
                    modelsLoading={loadingModels}
                    cwd={agentCwd}
                    browserToolEnabled={browserToolEnabled}
                    onToggleBrowserTool={toggleBrowserTool}
                    isFocused={focusedPaneId === paneId}
                    onFocus={() => setFocusedPaneId(paneId)}
                    tabs={pane.tabs}
                    activeTabId={pane.activeTabId}
                    onTabsChange={(nextTabs) => {
                      setPanesById((current) => {
                        const cur = current.get(paneId);
                        if (!cur) return current;
                        const next = new Map(current);
                        next.set(paneId, { ...cur, tabs: nextTabs });
                        return next;
                      });
                    }}
                    onActiveTabChange={(tabId) => {
                      setPanesById((current) => {
                        const cur = current.get(paneId);
                        if (!cur) return current;
                        const next = new Map(current);
                        next.set(paneId, { ...cur, activeTabId: tabId });
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
                            paneLoadersRef.current.delete(paneId);
                            if (focusedPaneId === paneId) {
                              const remaining = collectLeaves(layout).filter(
                                (id) => id !== paneId,
                              );
                              if (remaining[0]) setFocusedPaneId(remaining[0]);
                            }
                          }
                    }
                    registerExternalLoader={(loader) => registerPaneLoader(paneId, loader)}
                  />
                );
              }}
              onSplit={(paneId, direction, side, payload) => {
                // Create a new pane next to the drop target. If a session
                // payload is included, pre-load that session into the new
                // pane's tab on next tick (after registerExternalLoader fires).
                const id = newPaneId();
                const runtime = newRuntimeId();
                const baseTab = makeFreshTab();
                setPanesById((current) => {
                  const next = new Map(current);
                  next.set(id, {
                    tabs: [baseTab],
                    activeTabId: baseTab.id,
                    runtimeSessionId: runtime,
                  });
                  return next;
                });
                setLayout((prev) => splitLeaf(prev, paneId, id, direction, side));
                setFocusedPaneId(id);

                if (payload.piSessionId) {
                  const target = payload.piSessionId;
                  // Wait until the new ChatPane has mounted and registered
                  // its loader before requesting the replay.
                  const tryLoad = () => {
                    const loader = paneLoadersRef.current.get(id);
                    if (loader) {
                      loader(target);
                    } else {
                      setTimeout(tryLoad, 16);
                    }
                  };
                  setTimeout(tryLoad, 0);
                }
              }}
              onResize={(path, ratio) => {
                setLayout((prev) => setSplitRatio(prev, path, ratio));
              }}
            />
          </div>
        </section>

        {rightPanelOpen ? (
          <aside className="hidden w-[440px] shrink-0 flex-col border-l border-(--border) bg-(--bg) xl:flex">
            <div
              className="flex shrink-0 flex-col"
              style={{ height: `${rightTopHeightPct}%` }}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-(--border) px-3 text-xs text-(--dim)">
                <span className="font-medium uppercase tracking-wide">Browser</span>
                <button
                  type="button"
                  onClick={() => setRightPanelOpen(false)}
                  className="rounded p-1 hover:bg-(--surface) hover:text-(--fg)"
                  title="Close"
                  aria-label="Close browser"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <form
                onSubmit={submitBrowserUrl}
                className="flex shrink-0 items-center gap-1 border-b border-(--border) px-2 py-1.5"
              >
                <button
                  type="button"
                  onClick={browserBack}
                  className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
                  title="Back"
                  aria-label="Back"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={browserForward}
                  className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
                  title="Forward"
                  aria-label="Forward"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={browserReload}
                  className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
                  title="Reload"
                  aria-label="Reload"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <input
                  value={browserInput}
                  onChange={(event) => setBrowserInput(event.target.value)}
                  spellCheck={false}
                  placeholder="Search or enter URL"
                  className="min-w-0 flex-1 rounded border border-(--border) bg-(--surface) px-2 py-1 font-mono text-[11px] text-(--fg) outline-none placeholder:text-(--dim)"
                  aria-label="Browser address"
                />
              </form>
              <div className="min-h-0 flex-1 bg-white">
                {isElectron ? (
                  <webview
                    ref={(node) => {
                      webviewRef.current = (node as unknown as WebviewElement) ?? null;
                    }}
                    src={browserUrl}
                    allowpopups={true}
                    className="size-full"
                    style={{ width: "100%", height: "100%", display: "flex" }}
                  />
                ) : (
                  <iframe
                    ref={iframeRef}
                    src={browserUrl}
                    className="size-full"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="Agent browser"
                  />
                )}
              </div>
            </div>

            <PaneSplitter
              onResize={(deltaPx, panelHeight) => {
                if (panelHeight <= 0) return;
                const next = Math.min(
                  80,
                  Math.max(20, rightTopHeightPct + (deltaPx / panelHeight) * 100),
                );
                setRightTopHeightPct(next);
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(RIGHT_TOP_HEIGHT_KEY, String(Math.round(next)));
                }
              }}
            />

            <div
              className="flex min-h-0 flex-1 flex-col"
              style={{ height: `${100 - rightTopHeightPct}%` }}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-(--border) px-3 text-xs text-(--dim)">
                <span className="font-medium uppercase tracking-wide">Files</span>
              </div>
              <div className="min-h-0 flex-1">
                <FilesystemPanel cwd={activeProject?.path ?? null} />
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  activeId,
  onSelect,
  onOpen,
  onRemove,
  pickerOpen,
  onPickerOpenChange,
  pickerInput,
  onPickerInputChange,
  pickerError,
  onPickerSubmit,
  onPickerCancel,
  cwd,
  onCwdChange,
  running,
}: {
  projects: ProjectEntry[];
  activeId: string | null;
  onSelect: (project: ProjectEntry) => void;
  onOpen: () => void;
  onRemove: (id: string) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (value: boolean) => void;
  pickerInput: string;
  onPickerInputChange: (value: string) => void;
  pickerError: string;
  onPickerSubmit: (event: FormEvent) => void;
  onPickerCancel: () => void;
  cwd: string;
  onCwdChange: (value: string) => void;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = projects.find((entry) => entry.id === activeId) || null;

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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded border border-(--border) bg-(--surface) px-2 text-xs text-(--fg) hover:bg-(--bg)"
        title={active?.path || "No project selected"}
      >
        <Folder className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
        <span className="truncate">{active?.name || "Choose project"}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-50 w-80 overflow-hidden rounded-md border border-(--border) bg-(--surface) shadow-lg">
          <div className="max-h-72 overflow-y-auto p-1">
            {projects.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-(--dim)">
                No projects yet. Open a directory to get started.
              </div>
            ) : (
              projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  active={project.id === activeId}
                  onSelect={() => {
                    onSelect(project);
                    setOpen(false);
                  }}
                  onRemove={() => onRemove(project.id)}
                />
              ))
            )}
          </div>
          <div className="border-t border-(--border) p-2">
            {pickerOpen ? (
              <form onSubmit={onPickerSubmit} className="space-y-1.5">
                <input
                  value={pickerInput}
                  onChange={(event) => onPickerInputChange(event.target.value)}
                  placeholder="/Users/you/code/my-project"
                  spellCheck={false}
                  autoFocus
                  className="w-full rounded border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[11px] text-(--fg) outline-none"
                />
                {pickerError ? <div className="text-[11px] text-(--err)">{pickerError}</div> : null}
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={onPickerCancel}
                    className="h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="h-6 rounded bg-(--fg) px-2 text-[11px] font-medium text-(--bg)"
                  >
                    Add
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onOpen();
                  // Keep dropdown open so the inline form (web fallback) remains visible.
                  if (!isLikelyElectron()) onPickerOpenChange(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-(--border) px-2 py-1.5 text-xs text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
              >
                <Plus className="h-3.5 w-3.5" /> Open project…
              </button>
            )}
          </div>
          <div className="border-t border-(--border) p-2">
            <label className="block text-[10px] uppercase tracking-wide text-(--dim)">cwd</label>
            <input
              value={cwd}
              onChange={(event) => onCwdChange(event.target.value)}
              disabled={running}
              spellCheck={false}
              className="mt-1 w-full rounded border border-(--border) bg-(--bg) px-2 py-1 font-mono text-[11px] text-(--fg) outline-none disabled:opacity-60"
              aria-label="Agent working directory"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isLikelyElectron(): boolean {
  if (typeof window === "undefined") return false;
  return /electron/i.test(navigator.userAgent);
}

function ProjectRow({
  project,
  active,
  onSelect,
  onRemove,
}: {
  project: ProjectEntry;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`group flex items-start gap-2 rounded px-2 py-1.5 text-left ${
        active ? "bg-(--bg)" : "hover:bg-(--bg)"
      } ${project.exists ? "" : "opacity-60"}`}
    >
      <button
        type="button"
        onClick={onSelect}
        title={project.path}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
      >
        <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--dim)" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-(--fg)">{project.name}</span>
            {project.hasGit && project.branch ? (
              <span className="inline-flex items-center gap-1 rounded border border-(--border) px-1 font-mono text-[10px] text-(--dim)">
                <GitBranch className="h-2.5 w-2.5" />
                <span className="max-w-[80px] truncate">{project.branch}</span>
              </span>
            ) : null}
          </span>
          <span className="block truncate text-[10px] text-(--dim)">{project.path}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onRemove();
        }}
        className="mt-0.5 rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--surface) hover:text-(--err) group-hover:opacity-100"
        title="Remove from list"
        aria-label="Remove project"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// Vertical drag handle separating two stacked panes inside a flex column.
// Reports the cursor delta (in CSS px) and the parent panel's measured height
// so the caller can convert to a percentage for layout.
function PaneSplitter({
  onResize,
}: {
  onResize: (deltaPx: number, panelHeight: number) => void;
}) {
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const aside = (event.currentTarget.parentElement as HTMLElement | null);
    const panelHeight = aside?.getBoundingClientRect().height ?? 0;
    let lastY = startY;

    const onMove = (e: PointerEvent) => {
      const delta = e.clientY - lastY;
      lastY = e.clientY;
      onResize(delta, panelHeight);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={handlePointerDown}
      className="h-1.5 shrink-0 cursor-row-resize border-y border-(--border) bg-(--bg) hover:bg-(--surface)"
      title="Drag to resize"
    />
  );
}


