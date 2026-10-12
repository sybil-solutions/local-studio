/** Strip Bun-only debugging suffix from fetch/SSE errors so the UI stays readable. */
export function scrubTransportFetchErrorMessage(message: string): string {
  return message
    .replace(
      /\s*For more information, pass `verbose:\s*true`\s+in the second argument to fetch\(\)\.?\s*$/i,
      "",
    )
    .trimEnd();
}

const BENIGN_SSE_MESSAGE_PARTS = [
  "abort",
  "failed to fetch",
  "networkerror",
  "network error",
  "load failed",
  "terminated",
  "connection reset",
  "econnreset",
  "broken pipe",
];

function isAbortOrNetworkDomException(error: DOMException): boolean {
  return error.name === "AbortError" || error.name === "NetworkError";
}

function hasBenignSseErrorMessage(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    BENIGN_SSE_MESSAGE_PARTS.some((part) => msg.includes(part)) ||
    (msg.includes("socket") && msg.includes("closed"))
  );
}

/** Mid-stream TCP/TLS drops often surface as TypeError or runtime-specific messages (e.g. Bun). Treat as EOF for SSE. */
export function isBenignSseTransportFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error) return false;
  if (error instanceof DOMException) return isAbortOrNetworkDomException(error);
  if (error instanceof TypeError) return true;
  if (error instanceof Error) return error.name === "AbortError" || hasBenignSseErrorMessage(error);
  return false;
}
