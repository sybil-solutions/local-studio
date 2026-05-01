import { describe, expect, it } from "bun:test";
import { mergeUsagePayloads } from "./chat-database";

const usage = (model: string, requests: number, tokens: number): Record<string, unknown> => ({
  totals: {
    total_tokens: tokens,
    prompt_tokens: tokens - requests,
    completion_tokens: requests,
    total_requests: requests,
    successful_requests: requests,
    failed_requests: 0,
    success_rate: 100,
    unique_sessions: requests,
    unique_users: 0,
  },
  recent_activity: {
    last_hour_requests: requests,
    last_24h_requests: requests,
    prev_24h_requests: 0,
    last_24h_tokens: tokens,
  },
  by_model: [
    {
      model,
      requests,
      successful: requests,
      total_tokens: tokens,
      prompt_tokens: tokens - requests,
      completion_tokens: requests,
    },
  ],
  daily: [
    {
      date: "2026-04-26",
      requests,
      successful: requests,
      total_tokens: tokens,
      prompt_tokens: tokens - requests,
      completion_tokens: requests,
    },
  ],
  daily_by_model: [
    {
      date: "2026-04-26",
      model,
      requests,
      successful: requests,
      total_tokens: tokens,
      prompt_tokens: tokens - requests,
      completion_tokens: requests,
    },
  ],
  hourly_pattern: [{ hour: 13, requests, successful: requests, tokens }],
  peak_days: [{ date: "2026-04-26", requests, tokens }],
  peak_hours: [{ hour: 13, requests }],
});

describe("mergeUsagePayloads", () => {
  it("sums totals without double-counting grouped first rows", () => {
    const merged = mergeUsagePayloads([usage("a", 2, 20), usage("a", 3, 30)]);
    expect(merged?.["totals"]).toMatchObject({ total_requests: 5, total_tokens: 50 });
    expect((merged?.["by_model"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      model: "a",
      requests: 5,
      total_tokens: 50,
    });
    expect((merged?.["daily_by_model"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      model: "a",
      requests: 5,
      total_tokens: 50,
    });
  });
});
