// CRITICAL
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventManager } from "../modules/monitoring/event-manager";
import { DistributedClusterManager } from "../modules/distributed/cluster-manager";
import { DistributedStore } from "../stores/distributed-store";
import type { AppContext } from "../types/context";

let manager: DistributedClusterManager;

beforeEach(async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "distributed-manager-test-"));
  const store = new DistributedStore(join(temporaryDirectory, "test.db"));
  const context = {
    eventManager: createEventManager(),
  } as AppContext;
  manager = new DistributedClusterManager(context, store, 60_000);
  await manager.registerNode({ node_id: "node-a", backend: "vllm" });
  await manager.registerNode({ node_id: "node-b", backend: "vllm" });
});

describe("DistributedClusterManager", () => {
  it("rejects overlapping allocations for same model", async () => {
    await manager.setAllocation("model-x", "node-a", 0, 12);
    await expect(manager.setAllocation("model-x", "node-b", 10, 20)).rejects.toThrow(
      /overlaps with node node-a/,
    );
  });

  it("reports gaps and contiguous=false when topology has holes", async () => {
    await manager.setAllocation("model-x", "node-a", 0, 8);
    await manager.setAllocation("model-x", "node-b", 12, 20);
    const topology = manager.getTopology("model-x", 24);
    expect(topology.contiguous).toBe(false);
    expect(topology.issues.some((issue) => issue.type === "gap" && issue.start_layer === 8)).toBe(
      true,
    );
  });
});
