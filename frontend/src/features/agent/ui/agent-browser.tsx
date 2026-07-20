"use client";

/**
 * Embedded browser pane for the agent surface.
 *
 * Two surfaces, switched by a toggle on the toolbar:
 *
 * 1. Live mode (default in Electron) — renders the page through `<webview>`.
 *    Auto-detects "blank" (empty body / failed navigation) and falls back to
 *    Reading mode without user intervention.
 * 2. Reading mode (default in dev) — pulls the page through
 *    `/api/agent/browser/fetch`, strips scripts/styles, and renders clean
 *    text with markdown links. Always works because we're not relying on the
 *    upstream's CSP/X-Frame-Options.
 */
import { useCallback, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ReloadIcon } from "@/ui/icons";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";
import {
  ScreencastSurface,
  type BrowserPaneState,
} from "@/features/agent/ui/agent-browser-screencast";
import {
  useAgentBrowserEffects,
  useLocalhostSitesEffects,
  type LocalhostSite,
} from "@/features/agent/ui/agent-browser-effects";
import { LocalhostStartPage } from "@/features/agent/ui/agent-browser-start-page";
import { ReadingView, type ReadablePage } from "@/features/agent/ui/agent-browser-reading-view";

type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  src: string;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  getTitle: () => string;
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  capturePage: () => Promise<{ toDataURL: () => string }>;
  addEventListener: HTMLElement["addEventListener"];
  removeEventListener: HTMLElement["removeEventListener"];
};

type Props = {
  url: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onNavigate: (value: string) => void;
  onLocationChange: (value: string) => void;
  onClose: () => void;
  isElectron: boolean;
  /** Screencast polling pauses while the hosting panel is hidden. */
  visible?: boolean;
};

export function AgentBrowser({
  url,
  inputValue,
  onInputChange,
  onNavigate,
  onLocationChange,
  onClose,
  isElectron,
  visible = true,
}: Props) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [initialWebviewUrl] = useState(url);
  // Live mode is the server-side screencast; it is the default everywhere and
  // falls back to reading mode only when the host has no Chromium.
  const [readingMode, setReadingMode] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState<string | null>(null);
  const [navState, setNavState] = useState<BrowserPaneState | null>(null);
  const [readable, setReadable] = useState<ReadablePage | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [hasOpenedUrl, setHasOpenedUrl] = useState(() =>
    Boolean(url && url !== DEFAULT_BROWSER_URL),
  );
  const [localSites, setLocalSites] = useState<LocalhostSite[]>([]);
  const [localSitesLoading, setLocalSitesLoading] = useState(false);
  const [localSitesError, setLocalSitesError] = useState<string | null>(null);
  const showStartPage = !hasOpenedUrl && url === DEFAULT_BROWSER_URL;
  const addressValue = showStartPage && inputValue === DEFAULT_BROWSER_URL ? "" : inputValue;

  const fetchReadable = useCallback(async (target: string) => {
    setReadingLoading(true);
    setReadingError(null);
    try {
      const response = await fetch(`/api/agent/browser/fetch?url=${encodeURIComponent(target)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ReadablePage & { error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setReadable(payload);
    } catch (error) {
      setReadable(null);
      setReadingError(error instanceof Error ? error.message : "Failed to read page");
    } finally {
      setReadingLoading(false);
    }
  }, []);

  useAgentBrowserEffects({
    url,
    readingMode,
    isElectron,
    webviewRef,
    fetchReadable,
    onLocationChange,
    onNavState: setNavState,
    enabled: !showStartPage,
  });
  useLocalhostSitesEffects({
    enabled: showStartPage,
    onLoadingChange: setLocalSitesLoading,
    onSitesChange: setLocalSites,
    onErrorChange: setLocalSitesError,
  });

  const postLiveVerb = useCallback((verb: "back" | "forward" | "reload") => {
    void fetch(`/api/agent/browser/${verb}`, { method: "POST" }).catch(() => undefined);
  }, []);
  const handleBack = () => {
    if (readingMode) return;
    if (isElectron) {
      webviewRef.current?.goBack();
      return;
    }
    postLiveVerb("back");
  };
  const handleForward = () => {
    if (readingMode) return;
    if (isElectron) {
      webviewRef.current?.goForward();
      return;
    }
    postLiveVerb("forward");
  };
  const handleReload = () => {
    if (showStartPage) {
      setLocalSites([]);
      setLocalSitesError(null);
      setLocalSitesLoading(true);
      void fetch("/api/agent/browser/localhosts", { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { sites?: LocalhostSite[]; error?: string };
          if (!response.ok || payload.error) throw new Error(payload.error || "Failed to scan");
          setLocalSites(payload.sites ?? []);
        })
        .catch((error) =>
          setLocalSitesError(error instanceof Error ? error.message : "Failed to scan localhost"),
        )
        .finally(() => setLocalSitesLoading(false));
      return;
    }
    if (readingMode) {
      void fetchReadable(url);
      return;
    }
    if (isElectron) {
      webviewRef.current?.reload();
      return;
    }
    postLiveVerb("reload");
  };
  const navigateFromBrowser = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setHasOpenedUrl(true);
    onNavigate(clean);
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    navigateFromBrowser(addressValue);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-1 border-b border-(--border) px-2 py-1.5"
      >
        <button
          type="button"
          onClick={handleBack}
          disabled={readingMode || navState?.canGoBack === false}
          className="rounded p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-30"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={readingMode || navState?.canGoForward === false}
          className="rounded p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-30"
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="rounded p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          title="Reload"
          aria-label="Reload"
        >
          <ReloadIcon className="h-3.5 w-3.5" />
        </button>
        <input
          value={addressValue}
          onChange={(event) => onInputChange(event.target.value)}
          spellCheck={false}
          placeholder="Enter a URL or search local apps"
          className="min-w-0 flex-1 rounded border border-(--border) bg-(--surface) px-2 py-1 font-mono text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim)"
          aria-label="Browser address"
        />
        <button
          type="button"
          onClick={() => {
            if (liveUnavailable && readingMode) return;
            setReadingMode((value) => !value);
          }}
          disabled={Boolean(liveUnavailable && readingMode)}
          className={`shrink-0 rounded border px-1.5 py-1 text-[length:var(--fs-xs)] uppercase tracking-wide disabled:opacity-40 ${
            readingMode
              ? "border-(--accent) bg-(--accent)/10 text-(--accent)"
              : "border-(--border) text-(--dim) hover:text-(--fg)"
          }`}
          title={
            liveUnavailable && readingMode
              ? `Live view unavailable: ${liveUnavailable}`
              : readingMode
                ? "Switch to live view"
                : "Switch to reading mode"
          }
        >
          {readingMode ? "Reader" : "Live"}
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
          title="Close"
          aria-label="Close browser"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </form>
      {liveUnavailable ? (
        <div className="shrink-0 border-b border-(--err)/40 bg-(--err)/10 px-3 py-2 text-[length:var(--fs-xs)] text-(--err)">
          {liveUnavailable}. Set LOCAL_STUDIO_CHROME_PATH to a Chromium-based browser binary to
          enable the live view and screenshots; reading mode is active meanwhile.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-(--bg)">
        {showStartPage ? (
          <LocalhostStartPage
            sites={localSites}
            loading={localSitesLoading}
            error={localSitesError}
            query={addressValue}
            onQueryChange={onInputChange}
            onNavigate={navigateFromBrowser}
          />
        ) : readingMode ? (
          <ReadingView
            url={url}
            page={readable}
            error={readingError}
            loading={readingLoading}
            onLinkClick={onNavigate}
          />
        ) : isElectron ? (
          // Desktop: a real embedded Chromium webview. Loads file://, localhost,
          // and the public web directly — the same surface the agent drives.
          (() => {
            type AnyTag = "webview";
            const Tag = "webview" as AnyTag;
            return (
              <Tag
                ref={(node: WebviewElement | null) => {
                  webviewRef.current = node;
                }}
                src={initialWebviewUrl}
                // @ts-expect-error — Electron-specific attribute.
                allowpopups="true"
                className="size-full"
                style={{ width: "100%", height: "100%", display: "flex" }}
              />
            );
          })()
        ) : (
          <ScreencastSurface
            url={url}
            visible={visible}
            onState={(state) => {
              setNavState(state);
              if (state.url && state.url !== url) onLocationChange(state.url);
            }}
            onUnavailable={(error) => {
              setLiveUnavailable(error);
              setReadingMode(true);
            }}
          />
        )}
      </div>
    </section>
  );
}
