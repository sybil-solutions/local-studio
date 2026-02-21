import { describe, expect, it, vi } from "vitest";
import type { ApiCore } from "./core";
import { createDistributedApi } from "./distributed";

describe("createDistributedApi", () => {
  it("requests node list and status endpoints", async () => {
    const request = vi.fn().mockResolvedValue({});
    const api = createDistributedApi({ request } as unknown as ApiCore);

    await api.listDistributedNodes();
    await api.getDistributedStatus();

    expect(request).toHaveBeenCalledWith("/distributed/nodes");
    expect(request).toHaveBeenCalledWith("/distributed/status");
  });

  it("encodes node id for allocation write paths", async () => {
    const request = vi.fn().mockResolvedValue({});
    const api = createDistributedApi({ request } as unknown as ApiCore);

    await api.setDistributedAllocation("node/a", {
      model_id: "model-x",
      start_layer: 0,
      end_layer: 8,
    });
    await api.clearDistributedAllocation("node/a", "model-x");

    expect(request).toHaveBeenCalledWith("/distributed/allocations/node%2Fa", expect.any(Object));
    expect(request).toHaveBeenCalledWith(
      "/distributed/allocations/node%2Fa?model_id=model-x",
      expect.any(Object),
    );
  });
});
