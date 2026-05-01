import { afterEach, describe, expect, it } from "bun:test";
import { fetchHuggingFaceModelInfo } from "./huggingface-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchHuggingFaceModelInfo", () => {
  it("preserves namespace slash while encoding model path segments", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Response.json({ modelId: "stepfun-ai/Step-3.5-Flash-FP8", siblings: [] });
    }) as typeof fetch;

    await fetchHuggingFaceModelInfo("stepfun-ai/Step-3.5-Flash-FP8");

    expect(requestedUrl).toBe("https://huggingface.co/api/models/stepfun-ai/Step-3.5-Flash-FP8");
  });
});
