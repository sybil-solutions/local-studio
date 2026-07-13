import { describe, expect, test } from "bun:test";

import {
  createTestApp,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("proxy tokenization routes preserve fallbacks and observability without a live model", async () => {
    const app = await createTestApp();

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

    const chatTokenizeResponse = await app.request("/v1/tokenize-chat-completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "hello world" }],
      }),
    });
    const chatTokenizeBody = await chatTokenizeResponse.json();
    expect(chatTokenizeResponse.status).toBe(200);
    expect(chatTokenizeBody).toEqual({
      error: "No model running",
      input_tokens: 0,
    });

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
          path: "/v1/chat/completions",
          status: 400,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
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
