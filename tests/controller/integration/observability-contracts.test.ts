import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTestApp,
  createTestHarness,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
  tempDir,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("monitoring and log routes persist operational observability", async () => {
    const logsDir = join(tempDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(
      join(logsDir, "vllm_route-test.log"),
      "first line\nsecond line\n",
      "utf8",
    );
    const { app, context } = await createTestHarness();

    const prometheusResponse = await app.request("/metrics");
    const prometheusText = await prometheusResponse.text();
    expect(prometheusResponse.status).toBe(200);
    expect(prometheusResponse.headers.get("content-type")).toContain(
      "text/plain",
    );
    expect(prometheusText).toContain("local_studio");

    const currentMetricsResponse = await app.request("/v1/metrics/vllm");
    const currentMetricsBody = await currentMetricsResponse.json();
    expect(currentMetricsResponse.status).toBe(200);
    expect(currentMetricsBody).toMatchObject({
      model_id: null,
      model_path: null,
      served_model_name: null,
    });

    const peakMetricsResponse = await app.request("/peak-metrics");
    const peakMetricsBody = await peakMetricsResponse.json();
    expect(peakMetricsResponse.status).toBe(200);
    expect(peakMetricsBody).toEqual({ metrics: [] });

    const missingPeakResponse = await app.request(
      "/peak-metrics?model_id=missing-model",
    );
    const missingPeakBody = await missingPeakResponse.json();
    expect(missingPeakResponse.status).toBe(200);
    expect(missingPeakBody).toEqual({ error: "No metrics for this model" });

    const lifetimeResponse = await app.request("/lifetime-metrics");
    const lifetimeBody = await lifetimeResponse.json();
    expect(lifetimeResponse.status).toBe(200);
    expect(lifetimeBody).toMatchObject({
      tokens_total: 0,
      requests_total: 0,
      energy_wh: 0,
      current_power_watts: 0,
    });

    const benchmarkResponse = await app.request(
      "/benchmark?prompt_tokens=20&max_tokens=4",
      { method: "POST" },
    );
    const benchmarkBody = await benchmarkResponse.json();
    expect(benchmarkResponse.status).toBe(200);
    expect(benchmarkBody).toEqual({ error: "No model running" });

    const logsResponse = await app.request("/logs");
    const logsBody = await logsResponse.json();
    expect(logsResponse.status).toBe(200);
    expect(logsBody.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "route-test",
          recipe_id: "route-test",
          model: "route-test",
          status: "stopped",
        }),
      ]),
    );

    const logResponse = await app.request("/logs/route-test?limit=1");
    const logBody = await logResponse.json();
    expect(logResponse.status).toBe(200);
    expect(logBody).toEqual({
      id: "route-test",
      logs: ["second line"],
      content: "second line",
    });

    const streamController = new AbortController();
    const logStreamResponse = await app.request(
      "/logs/route-test/stream?tail=1",
      {
        signal: streamController.signal,
      },
    );
    expect(logStreamResponse.status).toBe(200);
    expect(logStreamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const logStreamReader = logStreamResponse.body?.getReader();
    expect(logStreamReader).toBeDefined();
    const logStreamChunk = await logStreamReader!.read();
    expect(logStreamChunk.done).toBe(false);
    const logStreamText = new TextDecoder().decode(logStreamChunk.value);
    expect(logStreamText).toContain("event: log");
    expect(logStreamText).toContain('"session_id":"route-test"');
    expect(logStreamText).toContain('"line":"second line"');
    streamController.abort();
    await logStreamReader!.cancel();

    const missingLogResponse = await app.request("/logs/missing-log");
    const missingLogBody = await missingLogResponse.json();
    expect(missingLogResponse.status).toBe(404);
    expect(missingLogBody).toEqual({ detail: "Log not found" });

    const controllerDeleteResponse = await app.request("/logs/controller", {
      method: "DELETE",
    });
    const controllerDeleteBody = await controllerDeleteResponse.json();
    expect(controllerDeleteResponse.status).toBe(400);
    expect(controllerDeleteBody).toEqual({
      detail: "controller logs cannot be deleted via API",
    });

    const eventStatsResponse = await app.request("/events/stats");
    const eventStatsBody = await eventStatsResponse.json();
    expect(eventStatsResponse.status).toBe(200);
    expect(eventStatsBody).toEqual({
      total_events_published: 0,
      channels: {},
      total_subscribers: 0,
    });

    const eventsController = new AbortController();
    const eventsResponse = await app.request("/events", {
      signal: eventsController.signal,
    });
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const eventsReader = eventsResponse.body?.getReader();
    expect(eventsReader).toBeDefined();
    const eventsRead = eventsReader!.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await context.eventManager.publishStatus({
      running: false,
      source: "route-contract-test",
    });
    const eventsChunk = await eventsRead;
    expect(eventsChunk.done).toBe(false);
    const eventsText = new TextDecoder().decode(eventsChunk.value);
    expect(eventsText).toContain("event: status");
    expect(eventsText).toContain('"running":false');
    expect(eventsText).toContain('"source":"route-contract-test"');
    eventsController.abort();
    await eventsReader!.cancel();

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/metrics/vllm",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/peak-metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/lifetime-metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/benchmark",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/route-test",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/route-test/stream",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/missing-log",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/logs/controller",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/events/stats",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "metrics.prometheus.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "metrics.current.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "benchmark.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "logs.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("usage includes persisted controller route observability", async () => {
    const app = await createTestApp();

    await app.request("/status");
    await app.request("/v1/models");
    await app.request("/controllers/route/status?target=file:///etc/passwd");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });

    const response = await app.request("/usage");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.controller.totals).toMatchObject({
      total_requests: 4,
      successful_requests: 2,
      failed_requests: 2,
      success_rate: 50,
    });
    expect(body.controller.latency.avg_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.latency.max_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.recent_activity).toMatchObject({
      last_hour_requests: 4,
      last_24h_requests: 4,
      last_24h_failed_requests: 2,
    });
    expect(body.controller.by_path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/status",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/controllers/route/status",
          requests: 1,
          failed: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/vram-calculator",
          requests: 1,
          failed: 1,
        }),
      ]),
    );
    expect(body.controller.by_status).toEqual(
      expect.arrayContaining([
        { status: 200, requests: 2 },
        { status: 400, requests: 2 },
      ]),
    );
    expect(body.controller.recent_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/vram-calculator", status: 400 }),
        expect.objectContaining({
          path: "/controllers/route/status",
          status: 400,
        }),
      ]),
    );
    expect(body.controller.function_calls.totals).toMatchObject({
      total_calls: 4,
      successful_calls: 4,
      failed_calls: 0,
      success_rate: 100,
    });
    expect(
      body.controller.function_calls.latency.avg_ms,
    ).toBeGreaterThanOrEqual(0);
    expect(
      body.controller.function_calls.latency.max_ms,
    ).toBeGreaterThanOrEqual(0);
    expect(body.controller.function_calls.by_function).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "models.list.findInferenceProcess",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
      ]),
    );

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "models.list.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("usage still returns controller observability when inference aggregation fails", async () => {
    const [{ createAppContext }, { createApp }] = await Promise.all([
      import("../../../controller/src/app-context"),
      import("../../../controller/src/http/app"),
    ]);
    const context = createAppContext();
    const aggregate = context.stores.inferenceRequestStore.aggregate.bind(
      context.stores.inferenceRequestStore,
    );
    context.stores.inferenceRequestStore.aggregate = () => {
      throw new Error("forced aggregate failure");
    };
    const app = createApp(context);

    await app.request("/status");

    const response = await app.request("/usage");
    const body = await response.json();

    context.stores.inferenceRequestStore.aggregate = aggregate;

    expect(response.status).toBe(200);
    expect(body.totals).toMatchObject({
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
    });
    expect(body.controller.totals).toMatchObject({
      total_requests: 1,
      successful_requests: 1,
      failed_requests: 0,
      success_rate: 100,
    });
    expect(body.controller.by_path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/status",
          requests: 1,
          successful: 1,
          failed: 0,
        }),
      ]),
    );
    expect(body.controller.function_calls.totals).toMatchObject({
      total_calls: 3,
      successful_calls: 2,
      failed_calls: 1,
    });
    expect(body.controller.function_calls.totals.success_rate).toBeCloseTo(
      66.666,
      2,
    );
    expect(body.controller.function_calls.recent_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          error_class: "Error",
          error_message: "forced aggregate failure",
        }),
      ]),
    );

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          success: 0,
          error_class: "Error",
          error_message: "forced aggregate failure",
        }),
      ]),
    );
  });

  test("pi-sessions usage route aggregates Pi JSONL session usage", async () => {
    const piDir = process.env.PI_CODING_AGENT_DIR;
    if (!piDir) throw new Error("PI_CODING_AGENT_DIR is required for tests");
    const sessionDir = join(piDir, "sessions", "personal");
    mkdirSync(sessionDir, { recursive: true });
    const timestamp = new Date().toISOString();
    writeFileSync(
      join(sessionDir, "session.jsonl"),
      [
        JSON.stringify({ type: "session", id: "pi-session-1" }),
        JSON.stringify({ type: "model_change", modelId: "deepseek-v4-flash" }),
        JSON.stringify({
          type: "message",
          timestamp,
          message: {
            role: "assistant",
            timestamp,
            usage: {
              input: 11,
              output: 7,
              totalTokens: 18,
              cacheRead: 5,
              cacheWrite: 3,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );
    const app = await createTestApp();

    const response = await app.request("/usage/pi-sessions");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totals).toMatchObject({
      total_tokens: 18,
      prompt_tokens: 11,
      completion_tokens: 7,
      total_requests: 1,
      successful_requests: 1,
      failed_requests: 0,
      unique_sessions: 1,
    });
    expect(body.cache).toMatchObject({
      hits: 1,
      misses: 1,
      hit_tokens: 5,
      miss_tokens: 3,
      hit_rate: 50,
    });
    expect(body.recent_activity).toMatchObject({
      last_hour_requests: 1,
      last_24h_requests: 1,
      last_24h_tokens: 18,
    });
    expect(body.by_model).toEqual([
      expect.objectContaining({
        model: "deepseek-v4-flash",
        requests: 1,
        total_tokens: 18,
        prompt_tokens: 11,
        completion_tokens: 7,
        success_rate: 100,
      }),
    ]);

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual([
      expect.objectContaining({
        function_name: "usage.aggregatePiSessions",
        success: 1,
        error_class: null,
        error_message: null,
      }),
    ]);
    expect(functionRows[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("controller observability persists normalized raw rows for every route action", async () => {
    const app = await createTestApp();

    await app.request("/status?ignored=1", {
      headers: { "user-agent": "controller-integration-test/1.0" },
    });
    await app.request("/missing-route");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "controller-integration-test/1.0",
      },
      body: JSON.stringify({ context_length: 0 }),
    });

    const rows = readControllerRequestRows();

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      method: "GET",
      path: "/status",
      status: 200,
      success: 1,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[1]).toMatchObject({
      method: "GET",
      path: "/missing-route",
      status: 404,
      success: 0,
      error_class: null,
      error_message: null,
    });
    expect(rows[2]).toMatchObject({
      method: "POST",
      path: "/vram-calculator",
      status: 400,
      success: 0,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
  });
});
