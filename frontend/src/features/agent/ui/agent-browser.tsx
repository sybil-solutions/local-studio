"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ReloadIcon } from "@/ui/icons";
import { Alert } from "@/ui";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";
import { ScreencastSurface } from "@/features/agent/ui/agent-browser-screencast";
import { useBrowserLiveState } from "@/features/agent/ui/agent-browser-live-store";
import {
  useAgentBrowserEffects,
  useLocalhostSitesEffects,
  type LocalhostSite,
} from "@/features/agent/ui/agent-browser-effects";
import { LocalhostStartPage } from "@/features/agent/ui/agent-browser-start-page";
import { ReadingView, type ReadablePage } from "@/features/agent/ui/agent-browser-reading-view";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type Props = {
  url: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onNavigate: (value: string) => boolean;
  onLocationChange: (value: string) => void;
  onClose: () => void;
  navigationError: string | null;
};

export function AgentBrowser({
  url,
  inputValue,
  onInputChange,
  onNavigate,
  onLocationChange,
  onClose,
  navigationError,
}: Props) {
  const [readingMode, setReadingMode] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState<string | null>(null);
  const [readable, setReadable] = useState<ReadablePage | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [hasOpenedUrl, setHasOpenedUrl] = useState(() =>
    Boolean(url && url !== DEFAULT_BROWSER_URL),
  );
  const [localSites, setLocalSites] = useState<LocalhostSite[]>([]);
  const [localSitesLoading, setLocalSitesLoading] = useState(false);
  const [localSitesError, setLocalSitesError] = useState<string | null>(null);
  const live = useBrowserLiveState();
  const onLocationChangeRef = useRef(onLocationChange);
  const navState = live.state;
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
    fetchReadable,
    enabled: !showStartPage,
  });
  useLocalhostSitesEffects({
    enabled: showStartPage,
    onLoadingChange: setLocalSitesLoading,
    onSitesChange: setLocalSites,
    onErrorChange: setLocalSitesError,
  });
  useMountSubscription(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);
  useMountSubscription(() => {
    if (live.location) onLocationChangeRef.current(live.location.url);
  }, [live.location?.revision]);
  useMountSubscription(() => {
    setLiveUnavailable(live.unavailable);
    if (live.unavailable) setReadingMode(true);
  }, [live.unavailable]);

  const postLiveVerb = useCallback((verb: "back" | "forward" | "reload") => {
    void fetch(`/api/agent/browser/${verb}`, { method: "POST" }).catch(() => undefined);
  }, []);
  const handleBack = () => {
    if (readingMode) return;
    postLiveVerb("back");
  };
  const handleForward = () => {
    if (readingMode) return;
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
    postLiveVerb("reload");
  };
  const navigateFromBrowser = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    if (onNavigate(clean)) setHasOpenedUrl(true);
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
      {navigationError ? (
        <Alert variant="error" className="m-2 shrink-0">
          {navigationError}
        </Alert>
      ) : null}
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
        ) : (
          <ScreencastSurface navigationError={live.navigationError} />
        )}
      </div>
    </section>
  );
}
