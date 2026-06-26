const TRACE_STORAGE_KEY = "local-studio:trace-agent-reasoning";

export function agentReasoningTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(TRACE_STORAGE_KEY) === "1" ||
      new URLSearchParams(window.location.search).has("traceAgentReasoning")
    );
  } catch {
    return false;
  }
}

export function traceAgentReasoning(stage: string, payload: unknown): void {
  if (!agentReasoningTraceEnabled()) return;
  console.log(`[agent-reasoning] ${stage}`, safeTraceString(payload));
}

function safeTraceString(payload: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(payload, (key, value: unknown) => {
      if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
      if (typeof value === "string" && value.length > 2_000) {
        return `${value.slice(0, 2_000)}...<truncated ${value.length - 2_000} chars>`;
      }
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  } catch {
    return String(payload);
  }
}
