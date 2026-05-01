// CRITICAL
import { describe, expect, it } from "bun:test";
import { CONTROLLER_EVENTS } from "../contracts/controller-events";
import type { Event } from "../modules/system/event-manager";
import { createEventManager } from "../modules/system/event-manager";

describe("runtime_summary event contract", () => {
  it("publishRuntimeSummary emits event with required keys", async () => {
    const em = createEventManager();
    const collected: Event[] = [];

    // Subscribe in background
    const sub = (async (): Promise<void> => {
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
    const event = collected[0]!;
    expect(event.type).toBe(CONTROLLER_EVENTS.RUNTIME_SUMMARY);
    expect(event.data["platform"]).toBeDefined();

    const platform = event.data["platform"] as { kind: string };
    expect(platform.kind).toBe("rocm");

    const gpuMon = event.data["gpu_monitoring"] as { available: boolean; tool: string };
    expect(gpuMon.available).toBe(true);
    expect(gpuMon.tool).toBe("amd-smi");

    const backends = event.data["backends"] as Record<string, { installed: boolean }>;
    expect(backends["vllm"]!.installed).toBe(true);
    expect(backends["sglang"]!.installed).toBe(false);

    const lease = event.data["lease"] as { holder: string };
    expect(lease.holder).toBe("test-model");
  });

  it("publishJobUpdated emits event with job data", async () => {
    const em = createEventManager();
    const collected: Event[] = [];

    const sub = (async (): Promise<void> => {
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
    expect(collected[0]!.type).toBe(CONTROLLER_EVENTS.JOB_UPDATED);
    expect(collected[0]!.data["id"]).toBe("job-1");
    expect(collected[0]!.data["status"]).toBe("running");
  });
});
