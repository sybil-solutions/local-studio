import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../core/command";

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const LLM_INSTANCE = "llm";

export type EngineLogMetrics = {
  runningRequests: number;
  pendingRequests: number;
  kvCacheUsage: number;
  generationThroughput: number;
  promptThroughput: number;
};

export const containerFromExtraArguments = (
  extraArguments: Record<string, unknown> | null | undefined,
): string | null => {
  const value =
    extraArguments?.["docker-container"] ??
    extraArguments?.["docker_container"] ??
    extraArguments?.["container-name"] ??
    extraArguments?.["container_name"];
  if (typeof value !== "string") return null;
  const container = value.trim();
  return CONTAINER_NAME.test(container) ? container : null;
};

export const containerFromInstanceReference = (
  reference: { readonly kind: string; readonly containerId?: string; readonly containerName?: string } | null,
): string | null => {
  if (!reference) return null;
  if (reference.kind === "docker" && typeof reference.containerId === "string" && reference.containerId.trim()) {
    return reference.containerId.trim();
  }
  if (
    reference.kind === "docker-pending" &&
    typeof reference.containerName === "string" &&
    CONTAINER_NAME.test(reference.containerName)
  ) {
    return reference.containerName;
  }
  return null;
};

export const llmInstanceName = (): string => LLM_INSTANCE;

export const discoverContainerPublishingPort = (port: number): Effect.Effect<string | null> =>
  runCommandAsyncEffect("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
    timeoutMs: 5_000,
    maxOutputBytes: 256 * 1024,
  }).pipe(
    Effect.map((result) => {
      if (result.status !== 0 || result.timedOut) return null;
      const needle = `:${port}->`;
      const hostNet = `:${port}/`;
      for (const line of result.stdout.split(/\r?\n/)) {
        const tab = line.indexOf("\t");
        if (tab <= 0) continue;
        const name = line.slice(0, tab).trim();
        const ports = line.slice(tab + 1);
        if (!CONTAINER_NAME.test(name)) continue;
        if (ports.includes(needle) || ports.includes(hostNet)) return name;
      }
      return null;
    }),
    Effect.catch(() => Effect.succeed(null)),
  );

export const parseEngineLogMetrics = (text: string): EngineLogMetrics | null => {
  let runningRequests = 0;
  let pendingRequests = 0;
  let kvCacheUsage = 0;
  let generationThroughput = 0;
  let promptThroughput = 0;
  let found = false;
  for (const line of text.split(/\r?\n/)) {
    const running = line.match(/#running-req:\s*(\d+)/);
    const pending = line.match(/#queue-req:\s*(\d+)/);
    const kv = line.match(/full token usage:\s*([\d.]+)/);
    const generation = line.match(/gen throughput \(token\/s\):\s*([\d.]+)/);
    const prompt = line.match(/input throughput \(token\/s\):\s*([\d.]+)/);
    if (!running && !generation && !prompt && !kv) continue;
    found = true;
    if (running) runningRequests = Number(running[1]);
    if (pending) pendingRequests = Number(pending[1]);
    if (kv) kvCacheUsage = Number(kv[1]);
    if (generation) generationThroughput = Number(generation[1]);
    if (prompt) promptThroughput = Number(prompt[1]);
  }
  if (!found) return null;
  return {
    runningRequests,
    pendingRequests,
    kvCacheUsage,
    generationThroughput,
    promptThroughput,
  };
};
