import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearApiKey, getApiKey, setApiKey } from "./api-key";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_VLLM_STUDIO_API_KEY;
  delete process.env.VLLM_STUDIO_API_KEY;
  clearApiKey();
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearApiKey();
});

describe("api key runtime store", () => {
  it("trims and clears runtime keys", () => {
    setApiKey("  runtime-key  ");
    expect(getApiKey()).toBe("runtime-key");
    clearApiKey();
    expect(getApiKey()).toBe("");
  });

  it("prefers public and server environment keys over runtime state", () => {
    setApiKey("runtime-key");
    process.env.VLLM_STUDIO_API_KEY = "server-key";
    expect(getApiKey()).toBe("server-key");
    process.env.NEXT_PUBLIC_VLLM_STUDIO_API_KEY = "public-key";
    expect(getApiKey()).toBe("public-key");
  });
});
