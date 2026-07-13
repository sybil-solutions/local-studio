import { describe, expect, test } from "bun:test";

import type { Config } from "../../src/config/env";
import { getEngineSpec } from "../../src/modules/engines/engine-spec";
import { detectBackend } from "../../src/modules/engines/process/process-utilities";

describe("process utilities", () => {
  test("does not classify frontend server paths as vLLM inference", () => {
    expect(
      detectBackend([
        "next-server",
        "/home/ser/projects/vllm/lmvllm/frontend/.next/standalone/frontend/server.js",
      ]),
    ).toBeNull();
  });

  test("classifies exact vLLM and SGLang launch invocations", () => {
    expect(detectBackend(["/opt/venvs/vllm/bin/vllm", "serve", "/models/model-a"])).toBe("vllm");
    expect(detectBackend(["python", "-m", "vllm.entrypoints.openai.api_server"])).toBe("vllm");
    expect(detectBackend(["python", "-m", "sglang.launch_server", "/models/model-b"])).toBe(
      "sglang",
    );
  });
});

describe("SGLang command builder", () => {
  test("emits the launch flags accepted by the installed SGLang runtime", () => {
    const command = getEngineSpec("sglang").buildCommand(
      {
        id: "glm-5.1",
        name: "GLM-5.1",
        model_path: "/mnt/llm_models/GLM-5.1-478B-REAP-NVFP4",
        backend: "sglang",
        env_vars: null,
        tensor_parallel_size: 4,
        pipeline_parallel_size: 1,
        max_model_len: 202752,
        gpu_memory_utilization: 0.94,
        kv_cache_dtype: "fp8_e4m3",
        max_num_seqs: 1,
        trust_remote_code: true,
        tool_call_parser: "glm47",
        reasoning_parser: "glm45",
        enable_auto_tool_choice: true,
        quantization: "modelopt_fp4",
        dtype: null,
        host: "0.0.0.0",
        port: 8000,
        served_model_name: "glm-5.1",
        python_path: null,
        extra_args: {
          "chunked-prefill-size": 4096,
          "page-size": 128,
          "enable-metrics": true,
        },
        max_thinking_tokens: null,
        thinking_mode: "conservative",
      } as never,
      { sglang_python: "python", data_dir: "/tmp/local-studio-test" } as Config,
    );

    expect(command.slice(0, 4)).toEqual(["python", "-m", "sglang.launch_server", "--model-path"]);
    expect(command).toContain("/mnt/llm_models/GLM-5.1-478B-REAP-NVFP4");
    expect(command).toContain("--context-length");
    expect(command).toContain("--max-running-requests");
    expect(command).toContain("--mem-fraction-static");
    expect(command).toContain("--tool-call-parser");
    expect(command).toContain("--reasoning-parser");
    expect(command).not.toContain("--enable-auto-tool-choice");
    expect(command).not.toContain("--max-model-len");
    expect(command).not.toContain("--max-num-seqs");
    expect(command).not.toContain("--gpu-memory-utilization");
  });
});
