import { describe, expect, it } from "vitest";
import { ContextManagementService } from "./service";
import { ContextManagementServiceFactory, contextManagementServiceFactory } from "./factory";
import { DEFAULT_CONTEXT_CONFIG } from "./types";

describe("context management service factory", () => {
  it("creates configured service instances", () => {
    const service = new ContextManagementServiceFactory().create({ preserveRecentMessages: 8 });

    expect(service).toBeInstanceOf(ContextManagementService);
    expect(service.config).toEqual({ ...DEFAULT_CONTEXT_CONFIG, preserveRecentMessages: 8 });
  });

  it("reuses the default singleton", () => {
    const first = contextManagementServiceFactory.createDefault();
    const second = contextManagementServiceFactory.createDefault();

    expect(first).toBe(second);
    expect(first.config).toEqual(DEFAULT_CONTEXT_CONFIG);
  });
});
