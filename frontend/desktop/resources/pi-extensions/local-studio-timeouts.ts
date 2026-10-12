// Type-only import: erased before module resolution, so this file stays
// loadable from the packaged Resources directory, which has no node_modules.
// A VALUE import from the pi package here is a bare runtime specifier that
// cannot resolve there — which is why isToolCallEventType (a one-line
// `event.toolName === name` check) is inlined below instead of imported.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_BASH_TIMEOUT_SECONDS = 120;
const MAX_BASH_TIMEOUT_SECONDS = 900;

function readSeconds(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.trunc(raw);
}

export default function localStudioTimeouts(pi: ExtensionAPI) {
  const defaultTimeout = readSeconds(
    "LOCAL_STUDIO_BASH_TIMEOUT_SECONDS",
    DEFAULT_BASH_TIMEOUT_SECONDS,
  );
  const maxTimeout = readSeconds("LOCAL_STUDIO_BASH_MAX_TIMEOUT_SECONDS", MAX_BASH_TIMEOUT_SECONDS);

  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { timeout?: unknown };
    const current = Number(input.timeout);
    if (!Number.isFinite(current) || current <= 0) {
      input.timeout = defaultTimeout;
      return;
    }
    input.timeout = Math.min(Math.trunc(current), maxTimeout);
  });
}
