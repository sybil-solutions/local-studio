import type { Logger } from "../../core/logger";
import type { LifetimeMetricsStore } from "../system/metrics-store";
import type {
  InferenceRequestRecord,
  InferenceRequestStore,
} from "../../stores/inference-request-store";
import { Effect } from "effect";

interface InferenceAccountingStores {
  lifetimeMetricsStore: Pick<
    LifetimeMetricsStore,
    "addCompletionTokens" | "addPromptTokens" | "addRequests" | "addTokens"
  >;
  inferenceRequestStore: Pick<InferenceRequestStore, "record">;
}

interface InferenceAccountingOptions {
  logger: Pick<Logger, "warn">;
  stores: InferenceAccountingStores;
}

export interface InferenceUsageInput {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prompt_tokens_details?: Record<string, number>;
  completion_tokens_details?: Record<string, number>;
}

export interface InferenceUsageTotals {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface InferenceRecordInput {
  usage: InferenceUsageInput | undefined;
  record: Omit<
    InferenceRequestRecord,
    | "cache_read_tokens"
    | "cache_write_tokens"
    | "completion_tokens"
    | "prompt_tokens"
    | "reasoning_tokens"
    | "streamed"
  >;
  streamed: boolean;
}

const hasBillableTokens = (totals: InferenceUsageTotals): boolean =>
  totals.promptTokens > 0 || totals.completionTokens > 0;

const readUsageTotals = (usage: InferenceUsageInput): InferenceUsageTotals => {
  const promptDetails = usage.prompt_tokens_details;
  const completionDetails = usage.completion_tokens_details;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.reasoning_tokens ?? completionDetails?.["reasoning_tokens"] ?? 0,
    cacheReadTokens: promptDetails?.["cached_tokens"] ?? usage.cache_read_tokens ?? 0,
    cacheWriteTokens: usage.cache_write_tokens ?? 0,
  };
};

const addLifetimeUsage = (
  stores: InferenceAccountingStores,
  totals: InferenceUsageTotals,
): Effect.Effect<void, unknown> =>
  Effect.all(
    [
      ...(totals.promptTokens > 0
        ? [
            stores.lifetimeMetricsStore.addPromptTokens(totals.promptTokens),
            stores.lifetimeMetricsStore.addTokens(totals.promptTokens),
          ]
        : []),
      ...(totals.completionTokens > 0
        ? [
            stores.lifetimeMetricsStore.addCompletionTokens(totals.completionTokens),
            stores.lifetimeMetricsStore.addTokens(totals.completionTokens),
          ]
        : []),
      ...(hasBillableTokens(totals) ? [stores.lifetimeMetricsStore.addRequests(1)] : []),
    ],
    { concurrency: 1, discard: true },
  );

const tryRecordInference = (
  options: InferenceAccountingOptions,
  record: InferenceRequestRecord,
): Effect.Effect<void> =>
  options.stores.inferenceRequestStore
    .record(record)
    .pipe(
      Effect.catch((recordError) =>
        Effect.sync(() =>
          options.logger.warn(`Failed to record inference request: ${String(recordError)}`),
        ),
      ),
    );

export const recordInferenceUsage = (
  options: InferenceAccountingOptions,
  input: InferenceRecordInput,
): Effect.Effect<InferenceUsageTotals | null, unknown> => {
  if (!input.usage) return Effect.succeed(null);
  const totals = readUsageTotals(input.usage);
  const record = hasBillableTokens(totals)
    ? tryRecordInference(options, {
        ...input.record,
        prompt_tokens: totals.promptTokens,
        completion_tokens: totals.completionTokens,
        reasoning_tokens: totals.reasoningTokens,
        cache_read_tokens: totals.cacheReadTokens,
        cache_write_tokens: totals.cacheWriteTokens,
        streamed: input.streamed,
      })
    : Effect.void;
  return addLifetimeUsage(options.stores, totals).pipe(Effect.andThen(record), Effect.as(totals));
};
