import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StudioDiagnostics } from "@/lib/types";
import { buildHardwareSummary } from "./step-hardware-model";

describe("hardware setup copy", () => {
  test("reports Apple Silicon as Metal with unified memory", () => {
    const diagnostics = {
      platform: "darwin",
      arch: "arm64",
      cpu_model: "Apple M4 Max",
      cpu_cores: 16,
      memory_total: 68_719_476_736,
      gpus: [{ name: "Apple M4 Max GPU", memory_total_mb: 65_536 }],
      runtime: { vllm_installed: false, vllm_version: null },
    } as StudioDiagnostics;
    const summary = buildHardwareSummary(diagnostics);
    assert.match(summary.gpu, /Apple M4 Max GPU/);
    assert.equal(summary.vram, "64 GB unified");
    assert.match(summary.runtime, /MLX or llama\.cpp/);
    assert.doesNotMatch(summary.runtime, /vLLM/);
  });
});
