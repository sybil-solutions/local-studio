import { describe, expect, test } from "bun:test";

import { modelNotRunningError } from "../../src/modules/proxy/openai-routes";

// The chat proxy never launches a model. When the wrong model is requested it
// returns a 503 — but the body MUST be OpenAI-shaped (`error.message`) or the
// pi agent SDK reports a bare "503 status code (no body)" and the user has no
// idea the selected model simply isn't running. These pin that contract.
describe("modelNotRunningError", () => {
  test("names the running model and the requested one, in both shapes", () => {
    const body = modelNotRunningError("glm-5.2", "nemotron-3-ultra");
    // OpenAI clients (the SDK) read error.message — this is what surfaces.
    expect(body.error.message).toBe(
      "Model glm-5.2 is running; nemotron-3-ultra is not. Launch it from the frontend before sending requests.",
    );
    expect(body.error.type).toBe("model_not_running");
    expect(body.error.code).toBe("model_not_running");
    // FastAPI-style `detail` kept for back-compat callers.
    expect(body.detail).toBe(body.error.message);
  });

  test("falls back to a 'no model running' message when nothing is loaded", () => {
    const body = modelNotRunningError(null, "glm-5.2");
    expect(body.error.message).toBe(
      "No model is running. Launch glm-5.2 from the frontend before sending requests.",
    );
    expect(body.detail).toBe(body.error.message);
    expect(body.error.type).toBe("model_not_running");
  });
});
