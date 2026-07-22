// Pure pi-event predicates shared by the agent runtime package
// (services/agent-runtime) and the frontend's client-side event pipeline.
// Keep this module dependency-free.

export function isAgentEndEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_end";
}

export function isAgentSettledEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_settled";
}

export function piEventIsSuccessfulCompaction(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
  if (!type.includes("compact") && !type.includes("compaction")) return false;
  if (type.includes("start") || type.includes("begin")) return false;
  if (
    event.error ||
    event.errorMessage ||
    event.aborted ||
    event.cancelled ||
    event.canceled ||
    event.failed
  ) {
    return false;
  }
  if (event.type === "compaction_end" && event.result == null) return false;
  const result = event.result && typeof event.result === "object" ? event.result : null;
  const status =
    typeof event.status === "string"
      ? event.status
      : result && "status" in result && typeof result.status === "string"
        ? result.status
        : "";
  return !/abort|cancel|error|fail/.test(status.toLowerCase());
}
