import { describe, expect, test } from "bun:test";

import { createTestApp, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

const chatRequest = (model: string, stream: boolean): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-source": "proxy-forwarding-test" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "hello" }],
    stream,
  }),
});

describe("chat completions proxy forwarding", () => {
  test("forwards a non-streaming completion and returns the upstream body", async () => {
    let upstreamBody: Record<string, unknown> | null = null;
    const upstream = Bun.serve({
      port: 0,
      fetch: async (request) => {
        upstreamBody = (await request.json()) as Record<string, unknown>;
        return Response.json({
          id: "cmpl-test",
          object: "chat.completion",
          model: upstreamBody["model"],
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hi there" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        });
      },
    });
    try {
      process.env.LOCAL_STUDIO_INFERENCE_PORT = String(upstream.port);
      const app = await createTestApp();

      const response = await app.request(
        "/v1/chat/completions",
        chatRequest("unmanaged-upstream-model", false),
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body["id"]).toBe("cmpl-test");
      const choices = body["choices"] as Array<Record<string, unknown>>;
      const message = choices[0]?.["message"] as Record<string, unknown>;
      expect(message["content"]).toBe("hi there");
      expect(upstreamBody).not.toBeNull();
      expect((upstreamBody as unknown as Record<string, unknown>)["model"]).toBe(
        "unmanaged-upstream-model",
      );
    } finally {
      upstream.stop(true);
    }
  });

  test("streams SSE frames through with a keepalive before the first upstream byte", async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hel" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "lo" } }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const upstream = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(frames.join(""), {
          headers: { "content-type": "text/event-stream" },
        }),
    });
    try {
      process.env.LOCAL_STUDIO_INFERENCE_PORT = String(upstream.port);
      const app = await createTestApp();

      const response = await app.request(
        "/v1/chat/completions",
        chatRequest("unmanaged-upstream-model", true),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const text = await new Response(response.body).text();
      expect(text.startsWith(": keepalive\n\n")).toBe(true);
      const contents = text
        .split("\n")
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>)
        .map((chunk) => {
          const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.["delta"] as Record<string, unknown> | undefined;
          return typeof delta?.["content"] === "string" ? delta["content"] : "";
        })
        .join("");
      expect(contents).toBe("hello");
      expect(text).toContain("data: [DONE]");
    } finally {
      upstream.stop(true);
    }
  });

  test("rejects a managed recipe model with an OpenAI-shaped 503 when it is not running", async () => {
    const app = await createTestApp();

    const createResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "proxy-test-recipe",
        name: "Proxy Test Recipe",
        model_path: "/models/proxy-test",
        served_model_name: "proxy-test-model",
        backend: "vllm",
      }),
    });
    expect([200, 201]).toContain(createResponse.status);

    const response = await app.request(
      "/v1/chat/completions",
      chatRequest("proxy-test-model", false),
    );
    const body = (await response.json()) as {
      error?: { message?: string; type?: string; code?: string };
      detail?: string;
    };

    expect(response.status).toBe(503);
    expect(body.error?.type).toBe("model_not_running");
    expect(body.error?.code).toBe("model_not_running");
    expect(body.error?.message).toContain("proxy-test-model");
    expect(body.detail).toBe(body.error?.message);
  });
});
