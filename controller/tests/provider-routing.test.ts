import { describe, expect, test } from "bun:test";
import { buildProviderApiUrl } from "../src/services/provider-routing";

describe("provider API URLs", () => {
  test("adds the OpenAI-compatible v1 prefix when the base URL omits it", () => {
    expect(buildProviderApiUrl("https://api.deepseek.com", "/models")).toBe(
      "https://api.deepseek.com/v1/models",
    );
  });

  test("does not duplicate an existing v1 prefix", () => {
    expect(buildProviderApiUrl("https://openrouter.ai/api/v1/", "chat/completions")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});
