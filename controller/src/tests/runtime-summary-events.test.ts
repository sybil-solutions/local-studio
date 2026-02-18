// CRITICAL
import { describe, expect, it } from "bun:test";
import { createEventManager, Event } from "../modules/monitoring/event-manager";

describe("runtime_summary event contract", () => {
  it("publishRuntimeSummary emits event with required keys", async () => {
    const em = createEventManager();
    const collected: Event[] = [];

    // Subscribe in background
    const sub = (async () => {
      for await (const event of em.subscribe()) {
        collected.push(event);
        break; // one event is enough
      }
    })();

    await em.publishRuntimeSummary({
      platform: { kind: "rocm", vendor: "amd" },
      gpu_monitoring: { available: true, tool: "amd-smi" },
      backends: {
        vllm: { installed: true, version: "0.6.0" },
        sglang: { installed: false, version: null },
        llamacpp: { installed: true, version: "b1234" },
      },
      lease: { holder: "test-model", since: "2026-01-01T00:00:00Z" },
    });

    await sub;

    expect(collected.length).toBe(1);
    const evt = collected[0]!;
    expect(evt.type).toBe("runtime_summary");
    expect(evt.data["platform"]).toBeDefined();

    const platform = evt.data["platform"] as { kind: string };
    expect(platform.kind).toBe("rocm");

    const gpuMon = evt.data["gpu_monitoring"] as { available: boolean; tool: string };
    expect(gpuMon.available).toBe(true);
    expect(gpuMon.tool).toBe("amd-smi");

    const backends = evt.data["backends"] as Record<string, { installed: boolean }>;
    expect(backends["vllm"]!.installed).toBe(true);
    expect(backends["sglang"]!.installed).toBe(false);

    const lease = evt.data["lease"] as { holder: string };
    expect(lease.holder).toBe("test-model");
  });

  it("publishJobUpdated emits event with job data", async () => {
    const em = createEventManager();
    const collected: Event[] = [];

    const sub = (async () => {
      for await (const event of em.subscribe()) {
        collected.push(event);
        break;
      }
    })();

    await em.publishJobUpdated({
      id: "job-1",
      type: "voice_assistant_turn",
      status: "running",
      progress: 50,
    });

    await sub;

    expect(collected.length).toBe(1);
    expect(collected[0]!.type).toBe("job_updated");
    expect(collected[0]!.data["id"]).toBe("job-1");
    expect(collected[0]!.data["status"]).toBe("running");
  });
});
