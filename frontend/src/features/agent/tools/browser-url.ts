import { sanitizeBrowserPaneUrl } from "@/features/agent/sanitize-embedded-browser-url";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";
import { workspaceFilePath } from "@/features/agent/workspace-file-link";

export type BrowserInputResolution =
  | { kind: "file"; path: string }
  | { kind: "navigate"; url: string }
  | { kind: "unsupported"; message: string };

const FILE_INPUT = /^(?:file:\/\/|~\/|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/iu;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const UNSUPPORTED_FILE = "Local files can only be opened from the active workspace.";
const UNSUPPORTED_URL = "Only public or localhost HTTP(S) URLs are supported.";

function navigation(url: string): BrowserInputResolution {
  const accepted = sanitizeBrowserPaneUrl(url);
  return accepted
    ? { kind: "navigate", url: accepted }
    : { kind: "unsupported", message: UNSUPPORTED_URL };
}

function fileResolution(value: string, cwd: string): BrowserInputResolution {
  const path = workspaceFilePath(value, cwd);
  return path ? { kind: "file", path } : { kind: "unsupported", message: UNSUPPORTED_FILE };
}

export function resolveBrowserInput(raw: string, cwd: string): BrowserInputResolution {
  const value = raw.trim();
  if (!value) return { kind: "navigate", url: DEFAULT_BROWSER_URL };
  if (FILE_INPUT.test(value)) return fileResolution(value, cwd);
  if (/^https?:\/\//iu.test(value)) return navigation(value);
  if (URI_SCHEME.test(value)) return { kind: "unsupported", message: UNSUPPORTED_URL };
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/iu.test(value)) {
    return navigation(`http://${value}`);
  }
  if (/^[\w.-]+:\d+([/?#].*)?$/u.test(value)) return navigation(`http://${value}`);
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/u.test(value)) {
    return navigation(`https://${value}`);
  }
  if (value.includes("/") || value.includes("\\")) return fileResolution(value, cwd);
  return navigation(`https://duckduckgo.com/?q=${encodeURIComponent(value)}`);
}

export function normalizeBrowserInput(raw: string, cwd: string): string {
  const result = resolveBrowserInput(raw, cwd);
  return result.kind === "navigate" ? result.url : "";
}
