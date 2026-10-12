// Session-title normalization shared by the agent runtime package (session
// summaries read from disk) and the frontend's client-side message helpers.

export function isPlaceholderSessionTitle(value: string | null | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return Boolean(normalized && /^(?:\.{3}|…)+$/.test(normalized));
}

export function cleanSessionTitle(value: string | null | undefined): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized && !isPlaceholderSessionTitle(normalized) ? normalized : "";
}

export function sessionTitleFromUserPrompt(value: string | null | undefined): string {
  if (!value) return "";
  const marker = "\n\nUser prompt:\n";
  const markerIndex = value.lastIndexOf(marker);
  const body = markerIndex === -1 ? value : value.slice(markerIndex + marker.length);
  const visible = body.replace(
    /^\s*<browser_context>(?:[\s\S]*?<\/browser_context>\s*|[\s\S]*$)/i,
    "",
  );
  return cleanSessionTitle(visible);
}

export const GENERATED_SESSION_TITLE_MAX_CHARS = 60;

export function generatedSessionTitle(value: string | null | undefined): string {
  const firstLine = (value ?? "").split(/\r?\n/).find((line) => line.trim()) ?? "";
  return cleanSessionTitle(firstLine.replace(/^["'`]+|["'`]+$/g, "")).slice(
    0,
    GENERATED_SESSION_TITLE_MAX_CHARS,
  );
}
