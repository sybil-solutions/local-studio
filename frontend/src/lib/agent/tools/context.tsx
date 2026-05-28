"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ComposerExtensionRef,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";
import { useCanvasEffects } from "@/hooks/agent/use-canvas-effects";
import { useToolsCatalogueEffects } from "@/hooks/agent/use-tools-catalogue-effects";
import type { SessionId } from "@/lib/agent/sessions/types";
import {
  EMPTY_SELECTION,
  type BrowserState,
  type ComputerState,
  type ComputerTab,
  type FileOpenRequest,
  type ToolSelection,
  type ToolSelectionMap,
} from "./types";
import {
  clampComputerWidth,
  loadBrowserState,
  loadComputerState,
  migrateToolStorage,
  uniqueComputerTabs,
  writeBrowserEnabled,
  writeComputerCanvasEnabled,
  writeComputerCanvasText,
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
} from "./persistence";

export type ToolsContextValue = {
  browser: BrowserState;
  computer: ComputerState;
  fileOpenRequest: FileOpenRequest | null;
  pluginCatalogue: ComposerPluginRef[];
  skillCatalogue: ComposerSkillRef[];
  promptTemplateCatalogue: ComposerPromptTemplateRef[];
  /**
   * Workspace-global Pi extension catalogue (installed packages + auto-
   * discovered drop-ins). Hydrated lazily — empty until the user opens the
   * `/plugins` slash menu or the plugins panel.
   */
  extensionCatalogue: ComposerExtensionRef[];
  refreshExtensionCatalogue: () => Promise<void>;
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
  setBrowserEnabled: (enabled: boolean) => void;
  toggleBrowser: () => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
  setComputerTab: (tab: ComputerTab) => void;
  closeComputerTab: (tab: ComputerTab) => void;
  setComputerWidth: (width: number) => void;
  setCanvasEnabled: (enabled: boolean) => void;
  toggleCanvas: () => void;
  setCanvasText: (text: string) => void;
  setActiveCanvasSession: (sessionId: SessionId | null) => void;
  requestFileOpen: (path: string) => void;
  /**
   * Replace the entire selection for a session. Pass `null` to clear it (used
   * when a session is closed / pruned).
   */
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

const ToolsContext = createContext<ToolsContextValue | null>(null);

function buildInitialBrowser(): BrowserState {
  if (typeof window === "undefined") {
    return { enabled: false, url: "", input: "" };
  }
  migrateToolStorage();
  return loadBrowserState();
}

function buildInitialComputer(): ComputerState {
  if (typeof window === "undefined") {
    return {
      open: false,
      tab: "status",
      tabs: ["status"],
      width: 0,
      canvasEnabled: false,
      canvasText: "",
    };
  }
  return loadComputerState();
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const [browser, setBrowser] = useState<BrowserState>(() => buildInitialBrowser());
  const [computer, setComputer] = useState<ComputerState>(() => buildInitialComputer());
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const [pluginCatalogue, setPluginCatalogue] = useState<ComposerPluginRef[]>([]);
  const [skillCatalogue, setSkillCatalogue] = useState<ComposerSkillRef[]>([]);
  const [promptTemplateCatalogue, setPromptTemplateCatalogue] = useState<
    ComposerPromptTemplateRef[]
  >([]);
  const [extensionCatalogue, setExtensionCatalogue] = useState<ComposerExtensionRef[]>([]);
  const selectionsRef = useRef<Map<SessionId, ToolSelection>>(new Map());
  // Bump on every selection mutation so consumers re-render.
  const [selectionVersion, setSelectionVersion] = useState(0);
  const activeCanvasSessionRef = useRef<SessionId | null>(null);
  const [activeCanvasSessionId, setActiveCanvasSessionIdState] = useState<SessionId | null>(null);
  const canvasQuery = (sessionId: SessionId | null) =>
    sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";

  // Discover the workspace-global plugin / skill catalogue once on mount.
  // The lifecycle bridge lives in `use-tools-catalogue-effects.ts`.
  useToolsCatalogueEffects({
    onLoaded: ({ plugins, skills, promptTemplates, extensions }) => {
      setPluginCatalogue(plugins);
      setSkillCatalogue(skills);
      setPromptTemplateCatalogue(promptTemplates);
      setExtensionCatalogue(extensions);
    },
  });
  useCanvasEffects({ setComputer, sessionId: activeCanvasSessionId });

  const setActiveCanvasSession = useCallback((sessionId: SessionId | null) => {
    activeCanvasSessionRef.current = sessionId;
    setActiveCanvasSessionIdState(sessionId);
  }, []);

  const setBrowserEnabled = useCallback((enabled: boolean) => {
    setBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
    writeBrowserEnabled(enabled);
  }, []);

  const toggleBrowser = useCallback(() => {
    setBrowser((current) => {
      const next = !current.enabled;
      writeBrowserEnabled(next);
      return { ...current, enabled: next };
    });
  }, []);

  const setBrowserUrl = useCallback((url: string, input?: string) => {
    if (typeof url !== "string" || !url.trim()) return;
    setBrowser((current) => ({
      ...current,
      url,
      input: input ?? current.input,
    }));
  }, []);

  const setBrowserInput = useCallback((input: string) => {
    if (typeof input !== "string") return;
    setBrowser((current) => ({ ...current, input }));
  }, []);

  const setComputerOpen = useCallback((open: boolean) => {
    setComputer((current) =>
      current.open === open
        ? current
        : {
            ...current,
            open,
            tab: open ? current.tab || "status" : current.tab,
            tabs: uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]),
          },
    );
  }, []);

  const toggleComputerOpen = useCallback(() => {
    setComputer((current) => ({
      ...current,
      open: !current.open,
      tab: !current.open ? current.tab || "status" : current.tab,
      tabs: uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]),
    }));
  }, []);

  const setComputerTab = useCallback((tab: ComputerTab) => {
    setComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      writeComputerTabs(tabs);
      return current.tab === tab && current.tabs === tabs
        ? current
        : { ...current, open: true, tab, tabs };
    });
    writeComputerTab(tab);
    if (tab === "browser") {
      setBrowser((current) => {
        if (current.enabled) return current;
        writeBrowserEnabled(true);
        return { ...current, enabled: true };
      });
    }
  }, []);

  const closeComputerTab = useCallback((tab: ComputerTab) => {
    if (tab === "status" || tab === "tools") return;
    setComputer((current) => {
      const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
      const activeTab = current.tab === tab ? (tabs[tabs.length - 1] ?? "status") : current.tab;
      writeComputerTabs(tabs);
      writeComputerTab(activeTab);
      return { ...current, tab: activeTab, tabs };
    });
  }, []);

  const setComputerWidth = useCallback((width: number) => {
    if (!Number.isFinite(width)) return;
    const clamped = clampComputerWidth(width);
    setComputer((current) =>
      current.width === clamped ? current : { ...current, width: clamped },
    );
    writeComputerWidth(clamped);
  }, []);

  const setCanvasEnabled = useCallback((enabled: boolean) => {
    setComputer((current) =>
      current.canvasEnabled === enabled ? current : { ...current, canvasEnabled: enabled },
    );
    writeComputerCanvasEnabled(enabled);
    // Best-effort server sync; the use-canvas-effects hook owns full hydration
    // and reconciliation. Failures here are harmless because the next mount
    // will re-read the server-side document.
    void fetch(`/api/agent/canvas${canvasQuery(activeCanvasSessionRef.current)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => undefined);
  }, []);

  const toggleCanvas = useCallback(() => {
    setComputer((current) => {
      const next = !current.canvasEnabled;
      const tabs = next ? uniqueComputerTabs([...current.tabs, "canvas"]) : current.tabs;
      writeComputerCanvasEnabled(next);
      if (next) writeComputerTabs(tabs);
      void fetch(`/api/agent/canvas${canvasQuery(activeCanvasSessionRef.current)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      }).catch(() => undefined);
      return {
        ...current,
        canvasEnabled: next,
        tabs,
        // When enabling the canvas, focus it; when disabling, fall back to status.
        tab: next ? "canvas" : current.tab === "canvas" ? "status" : current.tab,
        open: next ? true : current.open,
      };
    });
  }, []);

  const setCanvasText = useCallback((text: string) => {
    setComputer((current) =>
      current.canvasText === text ? current : { ...current, canvasText: text },
    );
    writeComputerCanvasText(text);
    void fetch(`/api/agent/canvas${canvasQuery(activeCanvasSessionRef.current)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, text }),
    }).catch(() => undefined);
  }, []);

  const requestFileOpen = useCallback((path: string) => {
    const clean = path.trim();
    if (!clean) return;
    setComputer((current) => ({ ...current, open: true, tab: "files" }));
    writeComputerTab("files");
    setFileOpenRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      path: clean,
    }));
  }, []);

  const selectionFor = useCallback(
    (sessionId: SessionId | null | undefined): ToolSelection => {
      if (!sessionId) return EMPTY_SELECTION;
      return selectionsRef.current.get(sessionId) ?? EMPTY_SELECTION;
    },
    // selectionVersion is read implicitly via the Ref; we depend on it so the
    // returned function identity changes when selections mutate.
    [selectionVersion],
  );

  const setSelection = useCallback((sessionId: SessionId, selection: ToolSelection | null) => {
    const map = selectionsRef.current;
    if (!selection) {
      if (!map.delete(sessionId)) return;
    } else {
      const current = map.get(sessionId);
      if (
        current &&
        current.plugins === selection.plugins &&
        current.skills === selection.skills &&
        current.promptTemplates === selection.promptTemplates &&
        current.extensionOverrides === selection.extensionOverrides
      ) {
        return;
      }
      map.set(sessionId, selection);
    }
    setSelectionVersion((v) => v + 1);
  }, []);

  const hydrateSelections = useCallback((entries: Iterable<[SessionId, ToolSelection]>) => {
    const map = selectionsRef.current;
    let changed = false;
    for (const [id, selection] of entries) {
      if (!selection) continue;
      const existing = map.get(id);
      if (
        existing &&
        existing.plugins === selection.plugins &&
        existing.skills === selection.skills &&
        existing.promptTemplates === selection.promptTemplates &&
        existing.extensionOverrides === selection.extensionOverrides
      ) {
        continue;
      }
      map.set(id, selection);
      changed = true;
    }
    if (changed) setSelectionVersion((v) => v + 1);
  }, []);

  const refreshExtensionCatalogue = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/extensions", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        resources?: {
          extensions?: Array<{
            path: string;
            source: string;
            enabled: boolean;
            origin: "package" | "top-level";
            scope: "user" | "project" | "temporary";
          }>;
        };
      };
      const extensions = payload.resources?.extensions ?? [];
      setExtensionCatalogue(
        extensions.map((ext) => {
          const id = ext.source && ext.source !== "auto" ? ext.source : ext.path;
          const name = deriveExtensionName(ext.source, ext.path);
          return {
            id,
            name,
            source: ext.source,
            path: ext.path,
            scope: ext.scope,
            origin: ext.origin,
            enabled: ext.enabled,
          };
        }),
      );
    } catch {
      // Best-effort; leave previous catalogue in place.
    }
  }, []);

  const value = useMemo<ToolsContextValue>(
    () => ({
      browser,
      computer,
      fileOpenRequest,
      pluginCatalogue,
      skillCatalogue,
      promptTemplateCatalogue,
      extensionCatalogue,
      refreshExtensionCatalogue,
      selectionFor,
      setBrowserEnabled,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      closeComputerTab,
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      setSelection,
      hydrateSelections,
    }),
    [
      browser,
      computer,
      fileOpenRequest,
      pluginCatalogue,
      skillCatalogue,
      promptTemplateCatalogue,
      extensionCatalogue,
      refreshExtensionCatalogue,
      selectionFor,
      setBrowserEnabled,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      closeComputerTab,
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      setSelection,
      hydrateSelections,
    ],
  );

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}

export function useTools(): ToolsContextValue {
  const value = useContext(ToolsContext);
  if (!value) throw new Error("useTools must be used within a ToolsProvider");
  return value;
}

export type { ToolSelection, ToolSelectionMap, BrowserState, ComputerState, ComputerTab };

function deriveExtensionName(source: string, absPath: string): string {
  // Prefer the package name from sources like "npm:@scope/foo" or "git:owner/repo".
  if (source && source !== "auto") {
    const m = /^(?:npm|git|file|ssh|https?):(.+)$/.exec(source);
    const tail = (m?.[1] ?? source).trim();
    const last = tail.split(/[\\/]/).filter(Boolean).pop();
    if (last) return last;
  }
  const base = absPath.split(/[\\/]/).filter(Boolean).pop() ?? absPath;
  return base.replace(/\.(?:t|j)sx?$/i, "");
}
