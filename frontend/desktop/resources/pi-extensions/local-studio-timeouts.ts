import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
    if (!isToolCallEventType("bash", event)) return;
    const current = Number(event.input.timeout);
    if (!Number.isFinite(current) || current <= 0) {
      event.input.timeout = defaultTimeout;
      return;
    }
    event.input.timeout = Math.min(Math.trunc(current), maxTimeout);
  });
}
