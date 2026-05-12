import { describe, expect, it } from "bun:test";
import type { InferenceRequestRecord } from "../../stores/inference-request-store";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
} from "./inference-accounting";

interface AccountingHarness {
  lifetime: Array<[string, number]>;
  records: InferenceRequestRecord[];
  warnings: string[];
  options: Parameters<typeof recordNonStreamingInferenceUsage>[0];
}

const createHarness = (): AccountingHarness => {
  const lifetime: Array<[string, number]> = [];
  const records: InferenceRequestRecord[] = [];
  const warnings: string[] = [];
  return {
    lifetime,
    records,
    warnings,
    options: {
      logger: { warn: (message: string): void => {
          warnings.push(message);
        } },
      stores: {
        lifetimeMetricsStore: {
          addPromptTokens: (tokens: number): void => {
            lifetime.push(["prompt", tokens]);
          },
          addCompletionTokens: (tokens: number): void => {
            lifetime.push(["completion", tokens]);
          },
          addTokens: (tokens: number): void => {
            lifetime.push(["tokens", tokens]);
          },
          addRequests: (count = 1): void => {
            lifetime.push(["requests", count]);
          },
        },
        inferenceRequestStore: {
          record: (record: InferenceRequestRecord): void => {
            records.push(record);
          },
        },
      },
    },
  };
};

const baseRecord = {
  model: "deepseek-v4-flash",
  source: "test-client",
  session_id: "session-1",
  provider: "local",
  duration_ms: 12,
  status: 200,
};

describe("inference accounting", () => {
  it("records non-streaming usage with token details", () => {
    const harness = createHarness();

    const totals = recordNonStreamingInferenceUsage(harness.options, {
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
      record: baseRecord,
    });

    expect(totals).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      reasoningTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
    });
    expect(harness.lifetime).toEqual([
      ["prompt", 11],
      ["tokens", 11],
      ["completion", 7],
      ["tokens", 7],
      ["requests", 1],
    ]);
    expect(harness.records).toEqual([
      {
        ...baseRecord,
        prompt_tokens: 11,
        completion_tokens: 7,
        reasoning_tokens: 2,
        cache_read_tokens: 3,
        cache_write_tokens: 0,
        streamed: false,
      },
    ]);
  });

  it("skips non-streaming accounting when upstream omitted usage", () => {
    const harness = createHarness();

    expect(
      recordNonStreamingInferenceUsage(harness.options, { usage: undefined, record: baseRecord })
    ).toBeNull();
    expect(harness.lifetime).toEqual([]);
    expect(harness.records).toEqual([]);
  });

  it("keeps streaming zero-token chunks out of request history", () => {
    const harness = createHarness();

    const totals = recordStreamingInferenceUsage(harness.options, {
      usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 4 },
      record: { ...baseRecord, ttft_ms: 3 },
    });

    expect(totals.reasoningTokens).toBe(4);
    expect(harness.lifetime).toEqual([]);
    expect(harness.records).toEqual([]);
  });

  it("logs and continues when request history persistence fails", () => {
    const harness = createHarness();
    harness.options.stores.inferenceRequestStore.record = (): void => {
      throw new Error("db unavailable");
    };

    recordStreamingInferenceUsage(harness.options, {
      usage: { prompt_tokens: 2, completion_tokens: 1, cache_read_tokens: 5 },
      record: { ...baseRecord, ttft_ms: 3 },
    });

    expect(harness.warnings).toEqual(["Failed to record inference request: db unavailable"]);
    expect(harness.lifetime).toContainEqual(["requests", 1]);
  });
});
