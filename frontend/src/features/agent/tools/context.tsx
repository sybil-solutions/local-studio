"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Context,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { SessionId } from "@/features/agent/runtime/types";
import {
  EMPTY_SELECTION,
  type BrowserBackend,
  type BrowserState,
  type ComputerState,
  type ComputerTab,
  type ContextAttachRequest,
  type FileOpenRequest,
  type ToolSelection,
  type ToolSelectionMap,
} from "@/features/agent/tools/types";
import {
  clampComputerWidth,
  computerPanelVisibility,
  loadBrowserState,
  loadComputerState,
  migrateToolStorage,
  uniqueComputerTabs,
  writeBrowserBackend,
  writeBrowserEnabled,
  writeComputerCanvasEnabled,
  writeComputerCanvasText,
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
} from "@/features/agent/tools/persistence";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  computerSessionView,
  patchSessionView,
  readSessionView,
  type SessionViewIdentity,
} from "@/features/agent/workspace/session-view-state";

// The tools surface is provided as four narrow contexts (actions / computer /
// browser / selections) so a state change in one slice never re-renders
// consumers of the others — e.g. typing in the browser URL bar must not churn
// every assistant-markdown block. `useTools()` composes all four for the
// pass-through consumers whose downstream prop contracts take the full value.
type ToolsActions = {
  setBrowserEnabled: (enabled: boolean) => void;
  setBrowserBackend: (backend: BrowserBackend) => void;
  toggleBrowserBackend: () => void;
  toggleBrowser: () => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
  setComputerTab: (tab: ComputerTab) => void;
  selectComputerTabWithoutOpening: (tab: ComputerTab) => void;
  closeComputerTab: (tab: ComputerTab) => void;
  setComputerWidth: (width: number) => void;
  setActiveComputerSession: (identity: SessionViewIdentity | null) => void;
  setCanvasEnabled: (enabled: boolean) => void;
  toggleCanvas: () => void;
  setCanvasText: (text: string) => void;
  setActiveCanvasSession: (sessionId: SessionId | null) => void;
  requestFileOpen: (path: string) => void;
  requestContextAttach: (request: { label: string; path?: string; content: string }) => void;
  /**
   * Replace the entire selection for a session. Pass `null` to clear it (used
   * when a session is closed / pruned).
   */
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

type ToolSelectionsValue = {
  fileOpenRequest: FileOpenRequest | null;
  contextAttachRequest: ContextAttachRequest | null;
  skillCatalogue: ComposerSkillRef[];
  promptTemplateCatalogue: ComposerPromptTemplateRef[];
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
};

export type ToolsContextValue = ToolsActions &
  ToolSelectionsValue & {
    browser: BrowserState;
    computer: ComputerState;
  };

const ToolsActionsContext = createContext<ToolsActions | null>(null);
const ComputerToolsContext = createContext<ComputerState | null>(null);
const BrowserToolsContext = createContext<BrowserState | null>(null);
const ToolSelectionsContext = createContext<ToolSelectionsValue | null>(null);
// Stable ref to the composed value for imperative (event-time) readers that
// must not re-render on tools churn — see `useToolsRef`.
const ToolsRefContext = createContext<{ current: ToolsContextValue } | null>(null);

type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  canvasEffectsEnabled: boolean;
  setComputer: Dispatch<SetStateAction<ComputerState>>;
  activeCanvasSessionId: SessionId | null;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

type ToolsEffectsBridgeComponent = ComponentType<ToolsEffectsBridgeProps>;

let toolsEffectsBridgePromise: Promise<ToolsEffectsBridgeComponent> | null = null;

function loadToolsEffectsBridge(): Promise<ToolsEffectsBridgeComponent> {
  toolsEffectsBridgePromise ??= import("@/features/agent/tools/effects-bridge").then(
    (mod) => mod.ToolsEffectsBridge,
  );
  return toolsEffectsBridgePromise;
}

function syncCanvasInBackground(
  sessionId: SessionId | null,
  payload: { enabled: boolean; text?: string },
): void {
  void import("@/features/agent/tools/canvas-effects").then((mod) => {
    mod.runSyncCanvasEffect(sessionId, payload);
  });
}

function LazyToolsEffectsBridge(props: ToolsEffectsBridgeProps) {
  const enabled = props.catalogueEnabled || props.canvasEffectsEnabled;
  const [ToolsEffectsBridge, setToolsEffectsBridge] = useState<ToolsEffectsBridgeComponent | null>(
    null,
  );

  useMountSubscription(() => {
    if (!enabled || ToolsEffectsBridge) return;
    let cancelled = false;
    void loadToolsEffectsBridge().then((Component) => {
      if (!cancelled) setToolsEffectsBridge(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [ToolsEffectsBridge, enabled]);

  return enabled && ToolsEffectsBridge ? <ToolsEffectsBridge {...props} /> : null;
}

function buildInitialBrowser(): BrowserState {
  if (typeof window === "undefined") {
    return { enabled: false, backend: "embedded", url: "", input: "" };
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
  const pathname = usePathname();
  const catalogueEnabled = pathname === "/agent" || pathname === "/quick";
  const canvasEffectsEnabled = pathname === "/agent" || pathname === "/quick";
  const [browser, setBrowser] = useState<BrowserState>(() => buildInitialBrowser());
  const [computer, setComputer] = useState<ComputerState>(() => buildInitialComputer());
  const activeComputerSessionRef = useRef<SessionViewIdentity | null>(null);
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const [contextAttachRequest, setContextAttachRequest] = useState<ContextAttachRequest | null>(
    null,
  );
  const [skillCatalogue, setSkillCatalogue] = useState<ComposerSkillRef[]>([]);
  const [promptTemplateCatalogue, setPromptTemplateCatalogue] = useState<
    ComposerPromptTemplateRef[]
  >([]);
  const selectionsRef = useRef<Map<SessionId, ToolSelection>>(new Map());
  const [selectionVersion, setSelectionVersion] = useState(0);
  const activeCanvasSessionRef = useRef<SessionId | null>(null);
  const [activeCanvasSessionId, setActiveCanvasSessionIdState] = useState<SessionId | null>(null);
  const updateComputer = useCallback<Dispatch<SetStateAction<ComputerState>>>((update) => {
    setComputer((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return current;
      const identity = activeComputerSessionRef.current;
      if (identity) {
        patchSessionView(window.localStorage, identity, { computer: computerSessionView(next) });
      }
      return next;
    });
  }, []);
  const handleCatalogueLoaded = useCallback(
    ({
      skills,
      promptTemplates,
    }: {
      skills: ComposerSkillRef[];
      promptTemplates: ComposerPromptTemplateRef[];
    }) => {
      setSkillCatalogue(skills);
      setPromptTemplateCatalogue(promptTemplates);
    },
    [],
  );

  const setActiveCanvasSession = useCallback((sessionId: SessionId | null) => {
    activeCanvasSessionRef.current = sessionId;
    setActiveCanvasSessionIdState(sessionId);
  }, []);

  const setBrowserEnabled = useCallback((enabled: boolean) => {
    setBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
    writeBrowserEnabled(enabled);
  }, []);

  const setBrowserBackend = useCallback((backend: BrowserBackend) => {
    setBrowser((current) => (current.backend === backend ? current : { ...current, backend }));
    writeBrowserBackend(backend);
  }, []);

  const toggleBrowserBackend = useCallback(() => {
    setBrowser((current) => {
      const backend = current.backend === "sitegeist" ? "embedded" : "sitegeist";
      writeBrowserBackend(backend);
      return { ...current, backend };
    });
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

  const setComputerOpen = useCallback(
    (open: boolean) => {
      updateComputer((current) => computerPanelVisibility(current, open));
    },
    [updateComputer],
  );

  const toggleComputerOpen = useCallback(() => {
    updateComputer((current) => computerPanelVisibility(current, !current.open));
  }, [updateComputer]);

  const setComputerTab = useCallback(
    (tab: ComputerTab) => {
      updateComputer((current) => {
        const tabs = uniqueComputerTabs([...current.tabs, tab]);
        writeComputerTabs(tabs);
        return current.tab === tab && current.tabs === tabs
          ? current
          : { ...current, open: true, tab, tabs };
      });
      writeComputerTab(tab);
      setBrowser((current) => {
        const enabled = tab === "browser";
        if (current.enabled === enabled) return current;
        writeBrowserEnabled(enabled);
        return { ...current, enabled };
      });
    },
    [updateComputer],
  );

  // Register + select a tab WITHOUT force-opening the computer panel. Used when
  // the model drives a background tool (e.g. the browser): it should route to the
  // right tab and pre-select it, but must not pop the panel open on every prompt
  // — the user controls whether the panel is visible.
  const selectComputerTabWithoutOpening = useCallback(
    (tab: ComputerTab) => {
      updateComputer((current) => {
        const tabs = uniqueComputerTabs([...current.tabs, tab]);
        writeComputerTabs(tabs);
        writeComputerTab(tab);
        return current.tab === tab && current.tabs === tabs ? current : { ...current, tab, tabs };
      });
      if (tab === "browser") {
        setBrowser((current) => {
          if (current.enabled) return current;
          writeBrowserEnabled(true);
          return { ...current, enabled: true };
        });
      }
    },
    [updateComputer],
  );

  const closeComputerTab = useCallback(
    (tab: ComputerTab) => {
      if (tab === "status" || tab === "tools") return;
      if (tab === "browser") {
        setBrowser((current) => {
          if (!current.enabled) return current;
          writeBrowserEnabled(false);
          return { ...current, enabled: false };
        });
      }
      updateComputer((current) => {
        const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
        const activeTab = current.tab === tab ? (tabs[tabs.length - 1] ?? "status") : current.tab;
        writeComputerTabs(tabs);
        writeComputerTab(activeTab);
        return { ...current, tab: activeTab, tabs };
      });
    },
    [updateComputer],
  );

  const setComputerWidth = useCallback(
    (width: number) => {
      if (!Number.isFinite(width)) return;
      const clamped = clampComputerWidth(width);
      updateComputer((current) =>
        current.width === clamped ? current : { ...current, width: clamped },
      );
      writeComputerWidth(clamped);
    },
    [updateComputer],
  );

  const setActiveComputerSession = useCallback((identity: SessionViewIdentity | null) => {
    const previous = activeComputerSessionRef.current;
    if (previous?.key === identity?.key) return;
    setComputer((current) => {
      if (previous) {
        patchSessionView(window.localStorage, previous, { computer: computerSessionView(current) });
      }
      activeComputerSessionRef.current = identity;
      const restored = identity ? readSessionView(window.localStorage, identity)?.computer : null;
      return restored ? { ...current, ...restored } : { ...current, open: false };
    });
  }, []);

  const setCanvasEnabled = useCallback(
    (enabled: boolean) => {
      updateComputer((current) =>
        current.canvasEnabled === enabled ? current : { ...current, canvasEnabled: enabled },
      );
      writeComputerCanvasEnabled(enabled);
      syncCanvasInBackground(activeCanvasSessionRef.current, { enabled });
    },
    [updateComputer],
  );

  const toggleCanvas = useCallback(() => {
    updateComputer((current) => {
      const next = !current.canvasEnabled;
      const tabs = next ? uniqueComputerTabs([...current.tabs, "canvas"]) : current.tabs;
      writeComputerCanvasEnabled(next);
      if (next) writeComputerTabs(tabs);
      syncCanvasInBackground(activeCanvasSessionRef.current, { enabled: next });
      return {
        ...current,
        canvasEnabled: next,
        tabs,
        tab: next ? "canvas" : current.tab === "canvas" ? "status" : current.tab,
        open: next ? true : current.open,
      };
    });
  }, [updateComputer]);

  const setCanvasText = useCallback(
    (text: string) => {
      updateComputer((current) =>
        current.canvasText === text ? current : { ...current, canvasText: text },
      );
      writeComputerCanvasText(text);
      syncCanvasInBackground(activeCanvasSessionRef.current, { enabled: true, text });
    },
    [updateComputer],
  );

  const requestFileOpen = useCallback(
    (path: string) => {
      const clean = path.trim();
      if (!clean) return;
      updateComputer((current) => ({ ...current, open: true, tab: "files" }));
      writeComputerTab("files");
      setFileOpenRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        path: clean,
      }));
    },
    [updateComputer],
  );

  const requestContextAttach = useCallback(
    (request: { label: string; path?: string; content: string }) => {
      const content = request.content.trim();
      if (!content) return;
      setContextAttachRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        label: request.label.trim() || "context",
        ...(request.path ? { path: request.path } : {}),
        content,
      }));
    },
    [],
  );

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
        current.skills === selection.skills &&
        current.promptTemplates === selection.promptTemplates
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
        existing.skills === selection.skills &&
        existing.promptTemplates === selection.promptTemplates
      ) {
        continue;
      }
      map.set(id, selection);
      changed = true;
    }
    if (changed) setSelectionVersion((v) => v + 1);
  }, []);

  // Every callback above is useCallback-stable except toggleComputerOpen
  // (depends on computer.open), so this value only changes identity when the
  // panel opens/closes — action-only consumers stay untouched by state churn.
  const actions = useMemo<ToolsActions>(
    () => ({
      setBrowserEnabled,
      setBrowserBackend,
      toggleBrowserBackend,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      selectComputerTabWithoutOpening,
      closeComputerTab,
      setComputerWidth,
      setActiveComputerSession,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    }),
    [
      setBrowserEnabled,
      setBrowserBackend,
      toggleBrowserBackend,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      selectComputerTabWithoutOpening,
      closeComputerTab,
      setComputerWidth,
      setActiveComputerSession,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    ],
  );

  const selections = useMemo<ToolSelectionsValue>(
    () => ({
      fileOpenRequest,
      contextAttachRequest,
      skillCatalogue,
      promptTemplateCatalogue,
      selectionFor,
    }),
    [fileOpenRequest, contextAttachRequest, skillCatalogue, promptTemplateCatalogue, selectionFor],
  );

  // Latest-value ref for imperative readers (use-workspace's event handlers).
  // Refreshed post-render, which is always before any event-time read.
  const value = useMemo<ToolsContextValue>(
    () => ({ browser, computer, ...selections, ...actions }),
    [browser, computer, selections, actions],
  );
  const valueRef = useRef(value);
  useMountSubscription(() => {
    valueRef.current = value;
  }, [value]);

  return (
    <ToolsActionsContext.Provider value={actions}>
      <ComputerToolsContext.Provider value={computer}>
        <BrowserToolsContext.Provider value={browser}>
          <ToolSelectionsContext.Provider value={selections}>
            <ToolsRefContext.Provider value={valueRef}>
              <LazyToolsEffectsBridge
                catalogueEnabled={catalogueEnabled}
                canvasEffectsEnabled={canvasEffectsEnabled}
                setComputer={updateComputer}
                activeCanvasSessionId={activeCanvasSessionId}
                onCatalogueLoaded={handleCatalogueLoaded}
              />
              {children}
            </ToolsRefContext.Provider>
          </ToolSelectionsContext.Provider>
        </BrowserToolsContext.Provider>
      </ComputerToolsContext.Provider>
    </ToolsActionsContext.Provider>
  );
}

function useToolsSlice<T>(context: Context<T | null>, hook: string): T {
  const value = useContext(context);
  if (value === null) throw new Error(`${hook} must be used within a ToolsProvider`);
  return value;
}

/** Stable tool callbacks only — never re-renders consumers on tools state churn. */
export function useToolsActions(): ToolsActions {
  return useToolsSlice(ToolsActionsContext, "useToolsActions");
}

/** Computer panel state (open/tab/tabs/width/canvas). */
export function useComputerTools(): ComputerState {
  return useToolsSlice(ComputerToolsContext, "useComputerTools");
}

/** Browser pane state (enabled/backend/url/input). */
export function useBrowserTools(): BrowserState {
  return useToolsSlice(BrowserToolsContext, "useBrowserTools");
}

/** Per-session skill/template selections, catalogues, and open/attach requests. */
export function useToolSelections(): ToolSelectionsValue {
  return useToolsSlice(ToolSelectionsContext, "useToolSelections");
}

/**
 * Ref to the full composed tools value for imperative event-time reads. Unlike
 * `useTools()`, subscribing components never re-render when tools state moves.
 */
export function useToolsRef(): { current: ToolsContextValue } {
  return useToolsSlice(ToolsRefContext, "useToolsRef");
}

/**
 * Composed compatibility view over all four tool contexts. Re-renders on any
 * tools state change, so prefer the narrow hooks; this exists for consumers
 * that hand the full value to prop contracts typed as `ToolsContextValue`.
 */
export function useTools(): ToolsContextValue {
  const actions = useToolsActions();
  const computer = useComputerTools();
  const browser = useBrowserTools();
  const selections = useToolSelections();
  return useMemo(
    () => ({ browser, computer, ...selections, ...actions }),
    [browser, computer, selections, actions],
  );
}

export type {
  ToolSelection,
  ToolSelectionMap,
  BrowserState,
  BrowserBackend,
  ComputerState,
  ComputerTab,
};
