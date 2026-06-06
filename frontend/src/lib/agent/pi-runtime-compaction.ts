export type RuntimeContextUsageLike = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type RuntimeContextUsageWithDecision = RuntimeContextUsageLike & {
  shouldCompact: boolean;
};

export function contextUsageAwaitingFreshCompactionUsage(
  usage: RuntimeContextUsageLike,
): RuntimeContextUsageLike & { shouldCompact: false } {
  return {
    tokens: null,
    contextWindow: usage.contextWindow,
    percent: null,
    shouldCompact: false,
  };
}

export function postCompactionUsageIsFresh(
  usage: RuntimeContextUsageWithDecision,
  tokensBefore: number | null,
): boolean {
  if (usage.tokens === null) return false;
  if (tokensBefore !== null) return usage.tokens < tokensBefore;
  return !usage.shouldCompact;
}

export function compactionTokensBefore(value: unknown): number | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const result =
    record?.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : null;
  const tokensBefore = result?.tokensBefore ?? record?.tokensBefore;
  return typeof tokensBefore === "number" && Number.isFinite(tokensBefore) ? tokensBefore : null;
}

type SdkSessionLike = {
  messages?: unknown;
  state?: {
    messages?: unknown;
  };
  agent?: {
    messages?: unknown;
    state?: {
      messages?: unknown;
    };
  };
  sessionManager?: { getBranch?: () => unknown };
};

export function normalizeSdkMessageTimestampsForCompactionBoundary(session: unknown): boolean {
  const sdkSession = session as SdkSessionLike | null | undefined;
  const messages = sdkSessionMessages(sdkSession);
  const branch = sdkSession?.sessionManager?.getBranch?.();
  if (!messages || !Array.isArray(branch)) return false;
  const compactionMs = normalizeBranchTimestampsAndLatestCompactionMs(branch);
  if (compactionMs === null) return true;
  const branchTimestamps = branchMessageTimestamps(branch);
  let sawPostCompactionMessage = false;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; timestamp?: unknown };
    const signature = messageSignature(record);
    const branchTimestamp = branchTimestamps.byObject.get(message);
    const fallbackTimestamp =
      branchTimestamp ?? consumeBranchMessageTimestamp(branchTimestamps.bySignature, signature);
    if (
      (record.timestamp === undefined || record.timestamp === null) &&
      typeof fallbackTimestamp === "number"
    ) {
      record.timestamp = fallbackTimestamp;
    }
    if (typeof branchTimestamp === "number") {
      consumeBranchMessageTimestamp(branchTimestamps.bySignature, signature, branchTimestamp);
    }
    if (typeof record.timestamp === "string") {
      const parsed = Date.parse(record.timestamp);
      if (Number.isFinite(parsed)) {
        record.timestamp = parsed;
      }
    }
    if (typeof record.timestamp === "number" && record.timestamp > compactionMs) {
      sawPostCompactionMessage = true;
    }
    if (
      !sawPostCompactionMessage &&
      record.role === "assistant" &&
      (record.timestamp === undefined || record.timestamp === null)
    ) {
      record.timestamp = compactionMs - 1;
    }
  }
  return true;
}

function sdkSessionMessages(session: SdkSessionLike | null | undefined): unknown[] | null {
  if (Array.isArray(session?.messages)) return session.messages;
  if (Array.isArray(session?.state?.messages)) return session.state.messages;
  if (Array.isArray(session?.agent?.messages)) return session.agent.messages;
  const stateMessages = session?.agent?.state?.messages;
  return Array.isArray(stateMessages) ? stateMessages : null;
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

function normalizeBranchTimestampsAndLatestCompactionMs(entries: unknown[]): number | null {
  let latest: number | null = null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; timestamp?: unknown };
    if (typeof record.timestamp === "string") {
      const parsed = Date.parse(record.timestamp);
      if (Number.isFinite(parsed)) record.timestamp = parsed;
    }
    if (
      latest !== null ||
      !isCompactionBoundaryEntry(record) ||
      typeof record.timestamp !== "number"
    ) {
      continue;
    }
    if (Number.isFinite(record.timestamp)) latest = record.timestamp;
  }
  return latest;
}

function branchMessageTimestamps(entries: unknown[]): {
  byObject: WeakMap<object, number>;
  bySignature: Map<string, number[]>;
} {
  const byObject = new WeakMap<object, number>();
  const bySignature = new Map<string, number[]>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; timestamp?: unknown; message?: unknown };
    if (record.type !== "message" || !record.message || typeof record.message !== "object") {
      continue;
    }
    const timestamp = timestampMs(record.timestamp);
    if (timestamp === null) continue;
    const message = record.message as { timestamp?: unknown };
    if (message.timestamp === undefined || message.timestamp === null) {
      message.timestamp = timestamp;
    } else if (typeof message.timestamp === "string") {
      const parsed = timestampMs(message.timestamp);
      if (parsed !== null) message.timestamp = parsed;
    }
    byObject.set(record.message, timestamp);
    const signature = messageSignature(record.message);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), timestamp]);
  }
  return { byObject, bySignature };
}

function consumeBranchMessageTimestamp(
  bySignature: Map<string, number[]>,
  signature: string,
  expected?: number,
): number | undefined {
  const timestamps = bySignature.get(signature);
  if (!timestamps?.length) return undefined;
  const index = typeof expected === "number" ? timestamps.indexOf(expected) : 0;
  const resolvedIndex = index >= 0 ? index : 0;
  const [timestamp] = timestamps.splice(resolvedIndex, 1);
  return timestamp;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageSignature(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const record = message as { role?: unknown; content?: unknown; stopReason?: unknown };
  return JSON.stringify({
    role: record.role,
    content: record.content,
    stopReason: record.stopReason,
  });
}

function isCompactionBoundaryEntry(record: { type?: unknown }): boolean {
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (!type.includes("compact") && !type.includes("compaction")) return false;
  return !type.includes("start") && !type.includes("begin");
}
