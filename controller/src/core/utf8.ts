export type Utf8State = {
  pendingContent: string;
  pendingReasoning: string;
};

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * Clean a streamed content chunk by repairing split surrogate pairs.
 * @param chunk - Incoming delta text.
 * @param state - Mutable state used to buffer a trailing high-surrogate across chunks.
 * @returns Cleaned chunk safe to append/render.
 */
export function cleanUtf8StreamContent(chunk: string, state: Utf8State): string {
  const pending = state.pendingContent || "";
  let text = pending + (chunk || "");
  state.pendingContent = "";

  if (!text) return text;

  const first = text.charCodeAt(0);
  if (isLowSurrogate(first)) {
    text = text.slice(1);
  }

  if (!text) return text;

  const last = text.charCodeAt(text.length - 1);
  if (isHighSurrogate(last)) {
    state.pendingContent = text.slice(-1);
    return text.slice(0, -1);
  }

  return text;
}
