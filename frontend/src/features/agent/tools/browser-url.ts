// Browser URL normalization for the embedded browser tool. Handles file://,
// relative paths under the project cwd, http(s), localhost, and a search-engine
// fallback for free-text input. Keep the fallback away from Google because the
// embedded WebKit view can get trapped on Google bot-protection refresh loops.

import { sanitizeLocalFileUrl } from "@/features/agent/sanitize-embedded-browser-url";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";

function encodeFilePath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${withLeadingSlash.split("/").map(encodeURIComponent).join("/")}`;
}

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

function resolveRelativeFilePath(cwd: string, value: string): string {
  const segments = `${cwd.replace(/[\\/]+$/, "")}/${value}`.split(/[\\/]/);
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const joined = resolved.join("/");
  return WINDOWS_ABSOLUTE_PATH.test(cwd) ? joined : `/${joined}`;
}

function expandHomeFilePath(cwd: string, value: string): string | null {
  const homeMatch = cwd.match(
    /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?:[\\/]|$)/,
  );
  if (!homeMatch) return null;
  return `${homeMatch[1]}${value.slice(1)}`;
}

export function normalizeBrowserInput(raw: string, cwd: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^file:\/\//i.test(value)) {
    return sanitizeLocalFileUrl(value) ?? "";
  }
  if (value.startsWith("~/") && cwd) {
    const expanded = expandHomeFilePath(cwd, value);
    if (expanded) return encodeFilePath(expanded);
  }
  if (value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(value)) return encodeFilePath(value);
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
  if ((value.includes("/") || value.includes("\\")) && cwd) {
    return encodeFilePath(resolveRelativeFilePath(cwd, value));
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}
