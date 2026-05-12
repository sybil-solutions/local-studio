import { afterEach, describe, expect, it } from "vitest";
import {
  resolveApiServerBaseUrl,
  resolveControllerEventsBaseUrl,
  resolveSettingsDefaultBackendUrl,
} from "./backend-config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("backend config resolution", () => {
  it("falls back to local defaults when env is empty", () => {
    delete process.env.BACKEND_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    delete process.env.VLLM_STUDIO_BACKEND_URL;

    expect(resolveApiServerBaseUrl()).toBe("http://localhost:8080");
    expect(resolveSettingsDefaultBackendUrl()).toBe("http://localhost:8080");
    expect(resolveControllerEventsBaseUrl()).toBe("/api/proxy");
  });

  it("uses the documented priority order and skips blank values", () => {
    process.env.BACKEND_URL = "   ";
    process.env.NEXT_PUBLIC_API_URL = "http://public-api";
    process.env.NEXT_PUBLIC_BACKEND_URL = "http://public-backend";
    process.env.VLLM_STUDIO_BACKEND_URL = "http://studio-backend";

    expect(resolveApiServerBaseUrl()).toBe("http://public-backend");
    expect(resolveSettingsDefaultBackendUrl()).toBe("http://public-api");
    expect(resolveControllerEventsBaseUrl()).toBe("http://public-backend");
  });
});
