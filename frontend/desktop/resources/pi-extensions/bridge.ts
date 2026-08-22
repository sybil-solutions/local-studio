// Shared plumbing for the Local Studio pi extensions.
//
// Every extension in this directory speaks the same tool-result shape and most
// of them proxy HTTP calls through the frontend with the same abort/timeout
// dance. Those pieces live here once; anything an extension does differently —
// response unwrapping, error wording, per-call budgets — stays in its own file.

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

export const textResult = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

export const failure = (text: string, details: Record<string, unknown> = {}): ToolResult =>
  textResult(text, { ...details, failed: true });

/** Where the frontend proxy lives. Read at call time so extensions that read
 *  config at registration (not import) keep that property. */
export function frontendBase(): string {
  return process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
}

/** A fetch signal that aborts on the turn's signal OR after timeoutMs.
 *  Call done() when the request settles to clear the timer and listener. */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}
