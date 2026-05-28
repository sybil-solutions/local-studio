import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsageStats } from "@/app/usage/lib/normalize-usage-stats";
import type { UsageStats } from "@/lib/types";

test("usage normalization preserves controller observability payload", () => {
  const normalized = normalizeUsageStats({
    totals: {
      total_requests: "4",
      successful_requests: "2",
      failed_requests: "2",
    },
    controller: {
      totals: {
        total_requests: "4",
        successful_requests: "2",
        failed_requests: "2",
        success_rate: "50",
      },
      latency: { avg_ms: "12.4", max_ms: "33" },
      recent_activity: {
        last_hour_requests: "4",
        last_24h_requests: "4",
        last_24h_failed_requests: "2",
      },
      by_path: [
        {
          method: "POST",
          path: "/vram-calculator",
          requests: "1",
          successful: "0",
          failed: "1",
          success_rate: "0",
          avg_duration_ms: "12",
          max_duration_ms: "12",
        },
      ],
      by_status: [{ status: "400", requests: "2" }],
      recent_errors: [
        {
          method: "POST",
          path: "/vram-calculator",
          status: "400",
          error_class: "",
          error_message: "model is required",
          created_at: "2026-05-26T12:00:00.000Z",
        },
      ],
      function_calls: {
        totals: {
          total_calls: "2",
          successful_calls: "1",
          failed_calls: "1",
          success_rate: "50",
        },
        latency: { avg_ms: "5.5", max_ms: "8" },
        by_function: [
          {
            function_name: "usage.aggregateInferenceRequests",
            calls: "1",
            successful: "0",
            failed: "1",
            success_rate: "0",
            avg_duration_ms: "8",
            max_duration_ms: "8",
          },
        ],
        recent_errors: [
          {
            function_name: "usage.aggregateInferenceRequests",
            error_class: "Error",
            error_message: "forced aggregate failure",
            created_at: "2026-05-26T12:00:01.000Z",
          },
        ],
      },
    },
  } as unknown as UsageStats);

  assert.equal(normalized.totals.total_requests, 4);
  assert.deepEqual(normalized.controller?.totals, {
    total_requests: 4,
    successful_requests: 2,
    failed_requests: 2,
    success_rate: 50,
  });
  assert.deepEqual(normalized.controller?.latency, {
    avg_ms: 12.4,
    max_ms: 33,
  });
  assert.deepEqual(normalized.controller?.recent_activity, {
    last_hour_requests: 4,
    last_24h_requests: 4,
    last_24h_failed_requests: 2,
  });
  assert.deepEqual(normalized.controller?.by_status, [
    { status: 400, requests: 2 },
  ]);
  assert.deepEqual(normalized.controller?.by_path[0], {
    method: "POST",
    path: "/vram-calculator",
    requests: 1,
    successful: 0,
    failed: 1,
    success_rate: 0,
    avg_duration_ms: 12,
    max_duration_ms: 12,
  });
  assert.deepEqual(normalized.controller?.recent_errors[0], {
    method: "POST",
    path: "/vram-calculator",
    status: 400,
    error_class: null,
    error_message: "model is required",
    created_at: "2026-05-26T12:00:00.000Z",
  });
  assert.deepEqual(normalized.controller?.function_calls?.totals, {
    total_calls: 2,
    successful_calls: 1,
    failed_calls: 1,
    success_rate: 50,
  });
  assert.deepEqual(normalized.controller?.function_calls?.latency, {
    avg_ms: 5.5,
    max_ms: 8,
  });
  assert.deepEqual(normalized.controller?.function_calls?.by_function[0], {
    function_name: "usage.aggregateInferenceRequests",
    calls: 1,
    successful: 0,
    failed: 1,
    success_rate: 0,
    avg_duration_ms: 8,
    max_duration_ms: 8,
  });
  assert.deepEqual(normalized.controller?.function_calls?.recent_errors[0], {
    function_name: "usage.aggregateInferenceRequests",
    error_class: "Error",
    error_message: "forced aggregate failure",
    created_at: "2026-05-26T12:00:01.000Z",
  });
});

test("usage normalization leaves controller observability absent when provider data has none", () => {
  const normalized = normalizeUsageStats(null);

  assert.equal(normalized.controller, undefined);
});
