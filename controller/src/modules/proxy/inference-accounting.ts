import type { Logger } from "../../core/logger";
import type { LifetimeMetricsStore } from "../system/metrics-store";
import type {
  InferenceRequestRecord,
  InferenceRequestStore,
} from "../../stores/inference-request-store";

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

interface InferenceUsageInput {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prompt_tokens_details?: Record<string, number>;
  completion_tokens_details?: Record<string, number>;
}

interface InferenceUsageTotals {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface NonStreamingInferenceRecordInput {
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
}

interface StreamingInferenceRecordInput {
  usage: InferenceUsageInput;
  record: Omit<
    InferenceRequestRecord,
    | "cache_read_tokens"
    | "cache_write_tokens"
    | "completion_tokens"
    | "prompt_tokens"
    | "reasoning_tokens"
    | "streamed"
  >;
}

const hasBillableTokens = (totals: InferenceUsageTotals): boolean =>
  totals.promptTokens > 0 || totals.completionTokens > 0;

const readUsageTotals = (usage: InferenceUsageInput): InferenceUsageTotals => {
  const promptDetails = usage.prompt_tokens_details;
  const completionDetails = usage.completion_tokens_details;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens:
      usage.reasoning_tokens ?? completionDetails?.["reasoning_tokens"] ?? 0,
    cacheReadTokens: promptDetails?.["cached_tokens"] ?? usage.cache_read_tokens ?? 0,
    cacheWriteTokens: usage.cache_write_tokens ?? 0,
  };
};

const addLifetimeUsage = (
  stores: InferenceAccountingStores,
  totals: InferenceUsageTotals
): void => {
  if (totals.promptTokens > 0) {
    stores.lifetimeMetricsStore.addPromptTokens(totals.promptTokens);
    stores.lifetimeMetricsStore.addTokens(totals.promptTokens);
  }
  if (totals.completionTokens > 0) {
    stores.lifetimeMetricsStore.addCompletionTokens(totals.completionTokens);
    stores.lifetimeMetricsStore.addTokens(totals.completionTokens);
  }
  if (hasBillableTokens(totals)) {
    stores.lifetimeMetricsStore.addRequests(1);
  }
};

const tryRecordInference = (
  options: InferenceAccountingOptions,
  record: InferenceRequestRecord
): void => {
  try {
    options.stores.inferenceRequestStore.record(record);
  } catch (recordError) {
    options.logger.warn(`Failed to record inference request: ${(recordError as Error).message}`);
  }
};

export const recordNonStreamingInferenceUsage = (
  options: InferenceAccountingOptions,
  input: NonStreamingInferenceRecordInput
): InferenceUsageTotals | null => {
  if (!input.usage) return null;

  const totals = readUsageTotals(input.usage);
  addLifetimeUsage(options.stores, totals);
  tryRecordInference(options, {
    ...input.record,
    prompt_tokens: totals.promptTokens,
    completion_tokens: totals.completionTokens,
    reasoning_tokens: totals.reasoningTokens,
    cache_read_tokens: totals.cacheReadTokens,
    cache_write_tokens: totals.cacheWriteTokens,
    streamed: false,
  });
  return totals;
};

export const recordStreamingInferenceUsage = (
  options: InferenceAccountingOptions,
  input: StreamingInferenceRecordInput
): InferenceUsageTotals => {
  const totals = readUsageTotals(input.usage);
  addLifetimeUsage(options.stores, totals);
  if (hasBillableTokens(totals)) {
    tryRecordInference(options, {
      ...input.record,
      prompt_tokens: totals.promptTokens,
      completion_tokens: totals.completionTokens,
      reasoning_tokens: totals.reasoningTokens,
      cache_read_tokens: totals.cacheReadTokens,
      cache_write_tokens: totals.cacheWriteTokens,
      streamed: true,
    });
  }
  return totals;
};
