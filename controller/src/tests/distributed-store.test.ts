// CRITICAL
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DistributedStore } from "../stores/distributed-store";

let store: DistributedStore;

beforeEach(() => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "distributed-store-test-"));
  store = new DistributedStore(join(temporaryDirectory, "test.db"));
});

describe("DistributedStore", () => {
  it("upserts and reads nodes", () => {
    store.upsertNode({
      node_id: "node-a",
      label: "Node A",
      backend: "vllm",
      transport: "local",
      host: "127.0.0.1",
      port: 9000,
      capabilities: JSON.stringify({ vendor: "nvidia" }),
      metrics: JSON.stringify({ load_pct: 5 }),
      status: "online",
      last_heartbeat_at: new Date().toISOString(),
    });

    const row = store.getNode("node-a");
    expect(row).not.toBeNull();
    expect(row!.backend).toBe("vllm");
    expect(store.listNodes().length).toBe(1);
  });

  it("upserts, lists, and deletes allocations", () => {
    store.upsertNode({
      node_id: "node-a",
      label: null,
      backend: null,
      transport: null,
      host: null,
      port: null,
      capabilities: "{}",
      metrics: "{}",
      status: "online",
      last_heartbeat_at: new Date().toISOString(),
    });
    store.upsertAllocation("model-x", "node-a", 0, 10);
    const list = store.listAllocations("model-x");
    expect(list.length).toBe(1);
    expect(list[0]?.start_layer).toBe(0);
    expect(list[0]?.end_layer).toBe(10);

    const removed = store.deleteAllocation("model-x", "node-a");
    expect(removed).toBe(true);
    expect(store.listAllocations("model-x").length).toBe(0);
  });
});
