// CRITICAL
import { afterEach, describe, expect, it } from "bun:test";
import type { Recipe } from "../modules/lifecycle/types";
import { buildEnvironment } from "../modules/lifecycle/process-utilities";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (typeof value === "string") {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
});

const makeRecipe = (extra_args: Record<string, unknown>): Recipe => ({
  id: "r1" as Recipe["id"],
  name: "test",
  model_path: "/models/test",
  backend: "vllm",
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 2048,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 1,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "0.0.0.0",
  port: 8000,
  served_model_name: null,
  python_path: null,
  extra_args,
  max_thinking_tokens: null,
  thinking_mode: "auto",
});

describe("buildEnvironment visible devices", () => {
  it("sets CUDA_VISIBLE_DEVICES in CUDA mode", () => {
    process.env["VLLM_STUDIO_GPU_SMI_TOOL"] = "nvidia-smi";
    const env = buildEnvironment(makeRecipe({ visible_devices: "0" }));
    expect(env["CUDA_VISIBLE_DEVICES"]).toBe("0");
    expect(env["HIP_VISIBLE_DEVICES"]).toBeUndefined();
    expect(env["ROCR_VISIBLE_DEVICES"]).toBeUndefined();
  });

  it("sets HIP/ROCR in ROCm mode", () => {
    process.env["VLLM_STUDIO_GPU_SMI_TOOL"] = "amd-smi";
    const env = buildEnvironment(makeRecipe({ visible_devices: "0" }));
    expect(env["HIP_VISIBLE_DEVICES"]).toBe("0");
    expect(env["ROCR_VISIBLE_DEVICES"]).toBe("0");
    expect(env["CUDA_VISIBLE_DEVICES"]).toBeUndefined();
  });

  it("sets all visibility keys when platform is unknown", () => {
    delete process.env["VLLM_STUDIO_GPU_SMI_TOOL"];
    const env = buildEnvironment(makeRecipe({ visible_devices: "0" }));
    expect(env["CUDA_VISIBLE_DEVICES"]).toBe("0");
    expect(env["HIP_VISIBLE_DEVICES"]).toBe("0");
    expect(env["ROCR_VISIBLE_DEVICES"]).toBe("0");
  });

  it("accepts legacy CUDA aliases as visible_devices input", () => {
    process.env["VLLM_STUDIO_GPU_SMI_TOOL"] = "amd-smi";
    const env = buildEnvironment(makeRecipe({ CUDA_VISIBLE_DEVICES: "2" }));
    expect(env["HIP_VISIBLE_DEVICES"]).toBe("2");
    expect(env["ROCR_VISIBLE_DEVICES"]).toBe("2");
  });

  it("lets explicit hip_visible_devices override projected values", () => {
    process.env["VLLM_STUDIO_GPU_SMI_TOOL"] = "amd-smi";
    const env = buildEnvironment(
      makeRecipe({ visible_devices: "0", hip_visible_devices: "2" })
    );
    expect(env["HIP_VISIBLE_DEVICES"]).toBe("2");
    expect(env["ROCR_VISIBLE_DEVICES"]).toBe("0");
  });

  it("supports rocr_visible_devices without generic visible_devices", () => {
    process.env["VLLM_STUDIO_GPU_SMI_TOOL"] = "amd-smi";
    const env = buildEnvironment(makeRecipe({ rocr_visible_devices: "3" }));
    expect(env["ROCR_VISIBLE_DEVICES"]).toBe("3");
    expect(env["HIP_VISIBLE_DEVICES"]).toBeUndefined();
  });
});
