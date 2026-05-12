import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";

const BROWSER_COMMAND_TIMEOUT_MS = 12_000;

export type BrowserCommandResult = { ok: boolean; data?: unknown; error?: string };

type BrowserWebviewImage = { toDataURL: () => string };

type BrowserWebview = {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  loadURL: (url: string) => Promise<unknown>;
  getURL: () => string;
  getTitle: () => string;
  capturePage: () => Promise<BrowserWebviewImage>;
};

export type BrowserCommandHost = {
  webview: BrowserWebview | null;
  iframe: HTMLIFrameElement | null;
};

export type BrowserCommandDeps = {
  browser: BrowserCommandHost | null;
  currentUrl: string;
  setBrowserUrl: (url: string, input?: string) => void;
  isElectron: boolean;
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

function isSafeBrowserSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 240 && !/[`;{}]/.test(selector);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function runBrowserPanelCommand(
  verb: string,
  payload: Record<string, unknown>,
  deps: BrowserCommandDeps,
): Promise<BrowserCommandResult> {
  const webview = deps.browser?.webview ?? null;
  if (deps.isElectron && webview && typeof webview.executeJavaScript === "function") {
    return runWebviewCommand(verb, payload, webview, deps.setBrowserUrl);
  }

  const iframe = deps.browser?.iframe ?? null;
  if (!iframe && verb === "get-url") return { ok: true, data: { url: deps.currentUrl, title: "" } };
  if (!iframe) return { ok: false, error: "Browser panel not mounted" };
  return runIframeCommand(verb, payload, iframe, deps.setBrowserUrl);
}

async function runWebviewCommand(
  verb: string,
  payload: Record<string, unknown>,
  webview: BrowserWebview,
  setBrowserUrl: BrowserCommandDeps["setBrowserUrl"],
): Promise<BrowserCommandResult> {
  try {
    switch (verb) {
      case "navigate":
        return navigateWebview(webview, payload, setBrowserUrl);
      case "get-url":
        return { ok: true, data: { url: webview.getURL(), title: webview.getTitle() } };
      case "get-text":
        return readProtectedWebviewText(
          webview.executeJavaScript("document.body && document.body.innerText"),
          "Browser text read",
          "text",
        );
      case "get-html":
        return readProtectedWebviewText(
          webview.executeJavaScript(
            "document.documentElement && document.documentElement.outerHTML",
          ),
          "Browser HTML read",
          "html",
        );
      case "screenshot":
        return captureWebviewScreenshot(webview);
      case "click":
        return clickWebviewSelector(webview, payload);
      case "scroll":
        return scrollWebview(webview, payload);
      case "fill":
        return fillWebviewSelector(webview, payload);
      default:
        return { ok: false, error: `Unsupported browser verb: ${verb}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function navigateWebview(
  webview: BrowserWebview,
  payload: Record<string, unknown>,
  setBrowserUrl: BrowserCommandDeps["setBrowserUrl"],
): Promise<BrowserCommandResult> {
  const url = sanitizePublicBrowserUrl(String(payload.url || ""));
  if (!url) return { ok: false, error: "valid public http(s) url required" };
  await withBrowserTimeout(webview.loadURL(url), "Browser navigation");
  setBrowserUrl(url, url);
  return { ok: true, data: { url } };
}

async function readProtectedWebviewText(
  operation: Promise<unknown>,
  label: string,
  key: "text" | "html",
): Promise<BrowserCommandResult> {
  const value = await withBrowserTimeout(operation, label);
  const text = typeof value === "string" ? value : "";
  const protectionError = detectBotProtection(text);
  return protectionError
    ? { ok: false, error: protectionError }
    : { ok: true, data: { [key]: text } };
}

async function captureWebviewScreenshot(webview: BrowserWebview): Promise<BrowserCommandResult> {
  const image = await withBrowserTimeout(webview.capturePage(), "Browser screenshot");
  return { ok: true, data: { dataUri: image.toDataURL() } };
}

async function clickWebviewSelector(
  webview: BrowserWebview,
  payload: Record<string, unknown>,
): Promise<BrowserCommandResult> {
  const selector = String(payload.selector || "");
  const selectorError = validateBrowserSelector(selector);
  if (selectorError) return selectorError;
  const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; (el).click(); return { found: true }; })()`;
  const value = await withBrowserTimeout(webview.executeJavaScript(script, true), "Browser click");
  return selectorResult(value);
}

async function scrollWebview(
  webview: BrowserWebview,
  payload: Record<string, unknown>,
): Promise<BrowserCommandResult> {
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

async function fillWebviewSelector(
  webview: BrowserWebview,
  payload: Record<string, unknown>,
): Promise<BrowserCommandResult> {
  const selector = String(payload.selector || "");
  const selectorError = validateBrowserSelector(selector);
  if (selectorError) return selectorError;
  const value = String(payload.value ?? "");
  const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { found: true }; })()`;
  const result = await withBrowserTimeout(webview.executeJavaScript(script, true), "Browser fill");
  return selectorResult(result);
}

function validateBrowserSelector(selector: string): BrowserCommandResult | null {
  if (!selector) return { ok: false, error: "selector required" };
  if (!isSafeBrowserSelector(selector)) return { ok: false, error: "unsupported selector" };
  return null;
}

function selectorResult(value: unknown): BrowserCommandResult {
  const found = isRecord(value) && value.found === true;
  return { ok: found, data: { found }, error: found ? undefined : "selector not found" };
}

function runIframeCommand(
  verb: string,
  payload: Record<string, unknown>,
  iframe: HTMLIFrameElement,
  setBrowserUrl: BrowserCommandDeps["setBrowserUrl"],
): BrowserCommandResult {
  switch (verb) {
    case "navigate": {
      const url = sanitizePublicBrowserUrl(String(payload.url || ""));
      if (!url) return { ok: false, error: "valid public http(s) url required" };
      iframe.src = url;
      setBrowserUrl(url, url);
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
}
