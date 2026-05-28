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
 *
 * The exported `WebviewElement` is the same handle the workspace's tool
 * bridge needs (executeJavaScript / loadURL / capturePage) so the agent can
 * still drive the browser when the user opts in.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ReloadIcon } from "@/components/icons";
import { useAgentBrowserEffects } from "@/hooks/agent/use-agent-browser-effects";
import { useLocalhostSitesEffects } from "@/hooks/agent/use-localhost-sites-effects";
import { DEFAULT_BROWSER_URL } from "@/lib/agent/tools/persistence";

export type WebviewElement = HTMLElement & {
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

type ReadablePage = {
  url: string;
  title: string;
  text: string;
  contentType?: string;
};

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

type Props = {
  url: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onNavigate: (value: string) => void;
  onLocationChange: (value: string) => void;
  onClose: () => void;
  isElectron: boolean;
};

export type AgentBrowserHandle = {
  webview: WebviewElement | null;
  iframe: HTMLIFrameElement | null;
};

export const AgentBrowser = forwardRef<AgentBrowserHandle, Props>(function AgentBrowser(
  { url, inputValue, onInputChange, onNavigate, onLocationChange, onClose, isElectron },
  ref,
) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [readingMode, setReadingMode] = useState(!isElectron);
  const [readable, setReadable] = useState<ReadablePage | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [liveBlank, setLiveBlank] = useState(false);
  const [hasOpenedUrl, setHasOpenedUrl] = useState(() =>
    Boolean(url && url !== DEFAULT_BROWSER_URL),
  );
  const [localSites, setLocalSites] = useState<LocalhostSite[]>([]);
  const [localSitesLoading, setLocalSitesLoading] = useState(false);
  const [localSitesError, setLocalSitesError] = useState<string | null>(null);
  const showStartPage = !hasOpenedUrl && url === DEFAULT_BROWSER_URL;
  const addressValue = showStartPage && inputValue === DEFAULT_BROWSER_URL ? "" : inputValue;

  useImperativeHandle(
    ref,
    () => ({
      get webview() {
        return webviewRef.current;
      },
      get iframe() {
        return iframeRef.current;
      },
    }),
    [],
  );

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
    setLiveBlank,
    enabled: !showStartPage,
  });
  useLocalhostSitesEffects({
    enabled: showStartPage,
    onLoadingChange: setLocalSitesLoading,
    onSitesChange: setLocalSites,
    onErrorChange: setLocalSitesError,
  });

  const handleBack = () => {
    if (readingMode) return;
    if (isElectron) webviewRef.current?.goBack();
  };
  const handleForward = () => {
    if (readingMode) return;
    if (isElectron) webviewRef.current?.goForward();
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
    if (isElectron) webviewRef.current?.reload();
    else if (iframeRef.current) {
      const current = iframeRef.current.src;
      iframeRef.current.src = current;
    }
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
          disabled={readingMode}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-30"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={readingMode}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-30"
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
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
          className="min-w-0 flex-1 rounded border border-(--border) bg-(--surface) px-2 py-1 font-mono text-[11px] text-(--fg) outline-none placeholder:text-(--dim)"
          aria-label="Browser address"
        />
        <button
          type="button"
          onClick={() => setReadingMode((value) => !value)}
          className={`shrink-0 rounded border px-1.5 py-1 text-[10px] uppercase tracking-wide ${
            readingMode
              ? "border-(--accent) bg-(--accent)/10 text-(--accent)"
              : "border-(--border) text-(--dim) hover:text-(--fg)"
          }`}
          title={readingMode ? "Switch to live view" : "Switch to reading mode"}
        >
          {readingMode ? "Reader" : "Live"}
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          title="Close"
          aria-label="Close browser"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </form>

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
          <>
            {}
            {(() => {
              type AnyTag = "webview";
              const Tag = "webview" as AnyTag;
              return (
                <Tag
                  ref={(node: WebviewElement | null) => {
                    webviewRef.current = node;
                  }}
                  src={url}
                  // @ts-expect-error — Electron-specific attribute.
                  allowpopups="true"
                  className="size-full"
                  style={{ width: "100%", height: "100%", display: "flex" }}
                />
              );
            })()}
            {liveBlank ? (
              <div className="absolute inset-x-0 top-10 z-10 mx-auto w-fit rounded border border-(--border) bg-(--surface) px-3 py-1.5 text-[11px] text-(--dim) shadow">
                Page came back empty —
                <button
                  type="button"
                  onClick={() => setReadingMode(true)}
                  className="ml-1 text-(--accent) underline-offset-2 hover:underline"
                >
                  open in reading mode
                </button>
                .
              </div>
            ) : null}
          </>
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            className="size-full bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="Agent browser"
          />
        )}
      </div>
    </section>
  );
});

function LocalhostStartPage({
  sites,
  loading,
  error,
  query,
  onQueryChange,
  onNavigate,
}: {
  sites: LocalhostSite[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (value: string) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSites = normalizedQuery
    ? sites.filter((site) =>
        `${site.title} ${site.displayUrl} ${site.process ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : sites;
  const canOpenQuery = Boolean(query.trim());
  return (
    <div className="size-full overflow-y-auto bg-(--bg) px-5 py-8 text-(--fg)">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[15px] font-medium text-(--dim)">Local</div>
            <div className="mt-1 text-[11px] text-(--dim)">
              Pick a running localhost app, or type a URL/search above.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="rounded-md px-2 py-1 text-[11px] text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          >
            Clear
          </button>
        </div>

        {canOpenQuery && filteredSites.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate(query)}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-(--border) bg-(--surface)/70 px-4 py-3 text-left hover:bg-(--surface)"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">Open “{query.trim()}”</span>
              <span className="mt-1 block text-[11px] text-(--dim)">Navigate in the browser</span>
            </span>
            <span className="text-lg text-(--dim)">↗</span>
          </button>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-(--border) bg-black/20 px-4 py-8 text-center text-xs text-(--dim)">
            Scanning localhost…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-(--err)/30 bg-(--err)/10 px-4 py-3 text-xs text-(--err)">
            {error}
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="rounded-xl border border-(--border) bg-black/20 px-4 py-8 text-center text-xs text-(--dim)">
            No running localhost web apps found.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredSites.map((site) => (
              <LocalhostSiteRow
                key={`${site.port}:${site.url}`}
                site={site}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalhostSiteRow({
  site,
  onNavigate,
}: {
  site: LocalhostSite;
  onNavigate: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(site.url)}
      className="group flex w-full items-center gap-4 rounded-xl border border-(--border) bg-black/10 px-3 py-3 text-left transition-colors hover:bg-(--surface)"
    >
      <span className="flex h-[58px] w-[92px] shrink-0 flex-col justify-between rounded-lg border border-white/20 bg-[#f4f4f4] p-2 shadow-inner">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b5f]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffd166]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ddc84]" />
        </span>
        <span className="space-y-1">
          <span className="block h-1.5 w-16 rounded-full bg-black/15" />
          <span className="block h-1.5 w-11 rounded-full bg-black/15" />
        </span>
        <span className="truncate text-[7px] font-semibold text-black/70">{site.title}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-tight text-(--fg)">
          {site.title}
        </span>
        <span className="mt-1 block truncate text-[13px] text-(--dim)">{site.displayUrl}</span>
      </span>
      {site.current ? (
        <span className="rounded-md border border-(--border) px-2 py-1 text-[11px] text-(--dim)">
          This chat
        </span>
      ) : null}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
    </button>
  );
}

function ReadingView({
  url,
  page,
  error,
  loading,
  onLinkClick,
}: {
  url: string;
  page: ReadablePage | null;
  error: string | null;
  loading: boolean;
  onLinkClick: (url: string) => void;
}) {
  if (loading && !page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">Loading…</div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-(--dim)">
        <span className="font-medium text-(--err)">Could not read {url}</span>
        <span>{error}</span>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">
        Enter a URL to read.
      </div>
    );
  }
  const segments = renderSegments(page.text, page.url, onLinkClick);
  return (
    <div className="size-full overflow-y-auto bg-(--bg) px-4 py-3 text-sm leading-6 text-(--fg)">
      <div className="mx-auto max-w-3xl">
        <div className="text-xs text-(--dim)">{page.url}</div>
        <h1 className="mt-1 text-base font-semibold tracking-tight text-(--fg)">{page.title}</h1>
        <article className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-(--fg)">
          {segments}
        </article>
      </div>
    </div>
  );
}

function resolveBrowserHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function renderSegments(text: string, baseUrl: string, onLinkClick: (url: string) => void) {
  const out: React.ReactNode[] = [];
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = linkRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }
    const label = match[1];
    const href = match[2];
    out.push(
      <button
        key={key++}
        type="button"
        onClick={() => onLinkClick(resolveBrowserHref(href, baseUrl))}
        className="text-(--accent) underline-offset-2 hover:underline"
        title={href}
      >
        {label}
      </button>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return out;
}
