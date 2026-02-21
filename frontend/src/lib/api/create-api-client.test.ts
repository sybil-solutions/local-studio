import { describe, expect, it } from "vitest";
import { createApiClient } from "./create-api-client";

describe("createApiClient", () => {
  it("exposes canonical system and logs methods without legacy aliases", () => {
    const api = createApiClient({ baseUrl: "http://localhost:8080", useProxy: false });

    expect(typeof api.launch).toBe("function");
    expect(typeof api.evict).toBe("function");
    expect(typeof api.getLogs).toBe("function");
    expect(typeof api.listDistributedNodes).toBe("function");
    expect(typeof api.setDistributedAllocation).toBe("function");

    expect("switchModel" in api).toBe(false);
    expect("evictModel" in api).toBe(false);
    expect("getLogContent" in api).toBe(false);
    expect("exportRecipes" in api).toBe(false);
  });
});
