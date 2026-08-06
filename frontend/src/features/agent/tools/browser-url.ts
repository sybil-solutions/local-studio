import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";

export function normalizeBrowserInput(raw: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^(?:file:\/\/|~\/|\.{1,2}\/|\/|[a-z]:[\\/])/i.test(value)) return "";
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
  if (value.includes("/") || value.includes("\\")) return "";
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}
