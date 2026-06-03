import type { CatalogueEntry, McpServer } from "./plugins-types";

export function serverDescription(server: McpServer): string {
  const summary = server.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
  return short || "MCP stdio server";
}

export function serverLocation(server: McpServer): string {
  const tags = server.tags?.length ? ` · ${server.tags.join(", ")}` : "";
  return `${server.enabled ? "enabled" : "disabled"} · @${server.name}${tags}`;
}

export function parseArgsText(text: string): string[] {
  return text
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseTagsText(text: string): string[] {
  return text
    .split(/[, ]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function missingRequiredEnv(entry: CatalogueEntry, env: Record<string, string>): boolean {
  return (entry.requiredEnv ?? []).some((key) => !env[key]?.trim());
}
