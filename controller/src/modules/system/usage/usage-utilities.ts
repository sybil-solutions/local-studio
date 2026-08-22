import { normalizeUsageStats, type UsageStats } from "@local-studio/contracts/usage";

/**
 * The body served when there is nothing to aggregate. The normalizer already
 * fills every counter, ratio and list from an empty input, so only latency and
 * TTFT are spelled out: the normalizer reports an absent duration as null, and
 * the empty response has always reported it as a zero.
 */
export const emptyResponse = (): Omit<UsageStats, "controller"> => ({
  ...normalizeUsageStats({}),
  latency: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0, min_ms: 0, max_ms: 0 },
  ttft: { avg_ms: 0, p50_ms: 0, p95_ms: 0, p99_ms: 0 },
});
