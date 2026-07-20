const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DOWNLOAD_UPSTREAM_TIMEOUT_MS = 120_000;
const SYSTEM_UPSTREAM_TIMEOUT_MS = 20_000;
const CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS = 600_000;
const MODEL_LIFECYCLE_TIMEOUT_MS = 360_000;
const SSE_CONNECT_TIMEOUT_MS = 5_000;
const SPEECH_GENERATION_TIMEOUT_MS = 360_000;
const VOICE_REFERENCE_TIMEOUT_MS = 120_000;
const POST_TIMEOUTS = new Map([
  ["studio/downloads", DOWNLOAD_UPSTREAM_TIMEOUT_MS],
  ["v1/audio/install", SYSTEM_UPSTREAM_TIMEOUT_MS],
  ["v1/audio/install/cancel", SYSTEM_UPSTREAM_TIMEOUT_MS],
  ["v1/audio/speech", SPEECH_GENERATION_TIMEOUT_MS],
  ["v1/audio/voices", VOICE_REFERENCE_TIMEOUT_MS],
  ["v1/audio/runtime/stop", SYSTEM_UPSTREAM_TIMEOUT_MS],
]);

export function getUpstreamTimeoutMs(path: string[], method = "GET"): number {
  const route = path.join("/");
  if (route.startsWith("launch/") || route === "wait-ready") {
    return MODEL_LIFECYCLE_TIMEOUT_MS;
  }
  const postTimeout = method === "POST" ? POST_TIMEOUTS.get(route) : undefined;
  if (postTimeout) return postTimeout;
  // SSE streams: this only bounds the initial connect (until headers arrive),
  // after which the stream runs unbounded. A longer window avoids EventSource
  // reconnect storms when the backend is briefly slow to respond.
  if (route === "events" || route.endsWith("/stream")) {
    return SSE_CONNECT_TIMEOUT_MS;
  }
  if (route === "v1/chat/completions" || route === "v1/responses") {
    return CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "compat") {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "config" || route === "evict") {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "logs" || route.startsWith("logs/")) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "v1/metrics/vllm") {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route.startsWith("runtime/")) {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS;
}
