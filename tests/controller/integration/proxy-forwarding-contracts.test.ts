import { describe, expect, test } from "bun:test";

import {
  createTestApp,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("invalid controller proxy targets fail before any upstream request is made", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/controllers/route/status?target=file:///etc/passwd",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("target must be an http(s) controller URL");
  });

  test("controller proxy forwards successful requests and records observability", async () => {
    const upstreamRequests: Array<{
      path: string;
      search: string;
      method: string;
      authorization: string | null;
    }> = [];
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        upstreamRequests.push({
          path: url.pathname,
          search: url.search,
          method: request.method,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({
          ok: true,
          path: url.pathname,
          params: Object.fromEntries(url.searchParams.entries()),
        });
      },
    });

    const target = `http://127.0.0.1:${upstream.port}`;
    // Cross-controller passthrough is deny-by-default; allowlist the test target.
    process.env.LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST = target;
    try {
      const app = await createTestApp();
      const response = await app.request(
        `/controllers/route/v1/models?target=${encodeURIComponent(target)}&limit=2`,
        { headers: { authorization: "Bearer proxy-test" } },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-vllm-routed-controller")).toBe(target);
      expect(body).toEqual({
        ok: true,
        path: "/v1/models",
        params: { limit: "2" },
      });
      expect(upstreamRequests).toEqual([
        {
          path: "/v1/models",
          search: "?limit=2",
          method: "GET",
          authorization: "Bearer proxy-test",
        },
      ]);

      const rows = readControllerRequestRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/controllers/route/v1/models",
            status: 200,
            success: 1,
          }),
        ]),
      );
    } finally {
      delete process.env.LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST;
      await upstream.stop(true);
    }
  });

  test("controller proxy forwards mutating request bodies and upstream statuses", async () => {
    const upstreamRequests: Array<{
      path: string;
      method: string;
      contentType: string | null;
      body: unknown;
    }> = [];
    const upstream = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        upstreamRequests.push({
          path: url.pathname,
          method: request.method,
          contentType: request.headers.get("content-type"),
          body: await request.json(),
        });
        return Response.json(
          {
            accepted: true,
            received: upstreamRequests.at(-1)?.body,
          },
          { status: 202 },
        );
      },
    });

    const target = `http://127.0.0.1:${upstream.port}`;
    // Cross-controller passthrough is deny-by-default; allowlist the test target.
    process.env.LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST = target;
    try {
      const app = await createTestApp();
      const payload = {
        model: "mock-model",
        messages: [{ role: "user", content: "hi" }],
      };
      const response = await app.request(
        `/controllers/route/v1/chat/completions?target=${encodeURIComponent(target)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(response.headers.get("x-vllm-routed-controller")).toBe(target);
      expect(body).toEqual({ accepted: true, received: payload });
      expect(upstreamRequests).toEqual([
        {
          path: "/v1/chat/completions",
          method: "POST",
          contentType: "application/json",
          body: payload,
        },
      ]);

      const rows = readControllerRequestRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            path: "/controllers/route/v1/chat/completions",
            status: 202,
            success: 1,
          }),
        ]),
      );
    } finally {
      delete process.env.LOCAL_STUDIO_CONTROLLER_ROUTE_ALLOWLIST;
      await upstream.stop(true);
    }
  });

  test("proxy tokenization routes preserve fallbacks and observability without a live model", async () => {
    const app = await createTestApp();

    const tokenizeResponse = await app.request("/v1/tokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", prompt: "hello world" }),
    });
    const tokenizeBody = await tokenizeResponse.json();
    expect(tokenizeResponse.status).toBe(200);
    expect(tokenizeBody).toEqual({ error: "No model running", num_tokens: 0 });

    const detokenizeResponse = await app.request("/v1/detokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", tokens: [1, 2, 3] }),
    });
    const detokenizeBody = await detokenizeResponse.json();
    expect(detokenizeResponse.status).toBe(200);
    expect(detokenizeBody).toEqual({ error: "No model running", text: "" });

    const countTokensResponse = await app.request("/v1/count-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", text: "hello world" }),
    });
    const countTokensBody = await countTokensResponse.json();
    expect(countTokensResponse.status).toBe(200);
    expect(countTokensBody).toEqual({
      error: "No model running",
      num_tokens: 0,
    });

    const chatTokenizeResponse = await app.request(
      "/v1/tokenize-chat-completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          messages: [{ role: "user", content: "hello world" }],
        }),
      },
    );
    const chatTokenizeBody = await chatTokenizeResponse.json();
    expect(chatTokenizeResponse.status).toBe(200);
    expect(chatTokenizeBody).toEqual({
      error: "No model running",
      input_tokens: 0,
    });

    const titleResponse = await app.request("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "Name this thread" }),
    });
    const titleBody = await titleResponse.json();
    expect(titleResponse.status).toBe(200);
    expect(titleBody).toEqual({ title: "New Chat" });

    const invalidChatResponse = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidChatBody = await invalidChatResponse.json();
    expect(invalidChatResponse.status).toBe(400);
    expect(invalidChatBody).toEqual({ detail: "Invalid JSON body" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/detokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/count-tokens",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize-chat-completions",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/api/title",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/chat/completions",
          status: 400,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "tokenize.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "detokenize.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "countTokens.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "tokenizeChatCompletions.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });
});
