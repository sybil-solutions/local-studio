import { describe, expect, test } from "bun:test";

import { InferenceRequestStore } from "./inference-request-store";

describe("InferenceRequestStore.aggregate cache metrics", () => {
  test("includes cache_read, cache_write, cache_hit_rate in by_model, daily, and daily_by_model", () => {
    const store = new InferenceRequestStore(":memory:");
    store.record({
      model: "test-model",
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_tokens: 80,
      cache_write_tokens: 20,
    });
    store.record({
      model: "test-model",
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_tokens: 90,
      cache_write_tokens: 10,
    });

    const agg = store.aggregate(new Set(["test-model"]));
    expect(agg).not.toBeNull();
    const result = agg as Record<string, unknown>;

    const byModel = result["by_model"] as Array<Record<string, unknown>>;
    expect(byModel).toEqual([
      expect.objectContaining({
        model: "test-model",
        cache_read: 170,
        cache_write: 30,
        cache_hit_rate: expect.closeTo(85, 1),
      }),
    ]);

    const daily = result["daily"] as Array<Record<string, unknown>>;
    expect(daily[0]).toMatchObject({ cache_read: 170, cache_write: 30 });
    expect(daily[0]?.["cache_hit_rate"] as number).toBeCloseTo(85, 0);

    const dailyByModel = result["daily_by_model"] as Array<Record<string, unknown>>;
    expect(dailyByModel[0]).toMatchObject({
      model: "test-model",
      cache_read: 170,
      cache_write: 30,
    });
    expect(dailyByModel[0]?.["cache_hit_rate"] as number).toBeCloseTo(85, 0);
  });

  test("cache_hit_rate guards against all-zero cache rows", () => {
    const store = new InferenceRequestStore(":memory:");
    store.record({ model: "no-cache-model", prompt_tokens: 10, completion_tokens: 5 });

    const agg = store.aggregate(new Set(["no-cache-model"])) as Record<string, unknown>;
    const byModel = agg["by_model"] as Array<Record<string, unknown>>;
    expect(byModel[0]).toMatchObject({ cache_read: 0, cache_write: 0, cache_hit_rate: 0 });

    const cache = agg["cache"] as Record<string, unknown>;
    expect(cache["hit_rate"]).toBe(0);
  });
});
