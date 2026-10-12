import type { InferenceUsageInput } from "./inference-accounting";

/**
 * Usage extraction for the three passthrough dialects. The controller never
 * rewrites what an engine says — these helpers only read token counts out of
 * response payloads (and SSE frames) so requests can be recorded.
 *
 * Field spellings differ per dialect: chat completions reports
 * prompt_tokens/completion_tokens, the Responses API and the Anthropic
 * Messages API both report input_tokens/output_tokens with their own cache and
 * reasoning detail shapes. Everything funnels into InferenceUsageInput.
 */
export type ProxyDialect = "chat" | "responses" | "messages";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

type CountField = "prompt_tokens" | "completion_tokens" | "reasoning_tokens" | "cache_read_tokens" | "cache_write_tokens";

const setCount = (target: InferenceUsageInput, field: CountField, value: unknown): void => {
  const count = asCount(value);
  if (count !== undefined) target[field] = count;
};

const chatUsage = (usage: Record<string, unknown>): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage["prompt_tokens"]);
  setCount(result, "completion_tokens", usage["completion_tokens"]);
  setCount(result, "reasoning_tokens", usage["reasoning_tokens"]);
  const promptDetails = asRecord(usage["prompt_tokens_details"]);
  const completionDetails = asRecord(usage["completion_tokens_details"]);
  if (promptDetails) result.prompt_tokens_details = promptDetails as Record<string, number>;
  if (completionDetails) {
    result.completion_tokens_details = completionDetails as Record<string, number>;
  }
  return result;
};

const responsesUsage = (usage: Record<string, unknown>): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage["input_tokens"]);
  setCount(result, "completion_tokens", usage["output_tokens"]);
  setCount(result, "reasoning_tokens", asRecord(usage["output_tokens_details"])?.["reasoning_tokens"]);
  setCount(result, "cache_read_tokens", asRecord(usage["input_tokens_details"])?.["cached_tokens"]);
  return result;
};

const messagesUsage = (usage: Record<string, unknown>): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage["input_tokens"]);
  setCount(result, "completion_tokens", usage["output_tokens"]);
  setCount(result, "cache_read_tokens", usage["cache_read_input_tokens"]);
  setCount(result, "cache_write_tokens", usage["cache_creation_input_tokens"]);
  return result;
};

/** Usage out of one payload: a non-streaming body, or one parsed SSE data frame. */
export const usageFromPayload = (
  dialect: ProxyDialect,
  payload: Record<string, unknown>,
): InferenceUsageInput | null => {
  // Streaming envelopes nest the usage: Responses under `response` on
  // response.completed, Messages under `message` on message_start.
  const envelope =
    dialect === "responses"
      ? (asRecord(payload["response"]) ?? payload)
      : dialect === "messages"
        ? (asRecord(payload["message"]) ?? payload)
        : payload;
  const usage = asRecord(envelope["usage"]);
  if (!usage) return null;
  const extracted =
    dialect === "chat"
      ? chatUsage(usage)
      : dialect === "responses"
        ? responsesUsage(usage)
        : messagesUsage(usage);
  return Object.keys(extracted).length > 0 ? extracted : null;
};

export interface UsageObserverCallbacks {
  /** Called with every usage payload seen; later fields overwrite earlier ones
   *  (the Messages dialect splits input and output across two events). */
  onUsage: (usage: InferenceUsageInput) => void;
  onFirstFrame: () => void;
}

/**
 * A pure observer for SSE bodies: every chunk is forwarded byte-for-byte and
 * unmodified, while a parallel line buffer splits frames to read usage. This is
 * what "pass through and deal with recording" means mechanically — the client
 * sees exactly what the engine sent.
 */
export const createUsageObserver = (
  dialect: ProxyDialect,
  callbacks: UsageObserverCallbacks,
): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  let buffer = "";
  let sawFrame = false;

  const observeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    if (!sawFrame) {
      sawFrame = true;
      callbacks.onFirstFrame();
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data) as unknown;
      const record = asRecord(parsed);
      if (!record) return;
      const usage = usageFromPayload(dialect, record);
      if (usage) callbacks.onUsage(usage);
    } catch {
      // Partial or non-JSON frame: recording is best-effort, forwarding is not.
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) observeLine(line);
    },
    flush(): void {
      buffer += decoder.decode();
      if (buffer) observeLine(buffer);
    },
  });
};
