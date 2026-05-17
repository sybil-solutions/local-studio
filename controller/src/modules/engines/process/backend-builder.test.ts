import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import { asRecipeId } from "../../../types/brand";
import type { Recipe } from "../../models/types";
import { buildBackendCommand } from "./backend-builder";

const baseRecipe: Recipe = {
  id: asRecipeId("r1"),
  name: "custom",
  model_path: "/models/test",
  backend: "sglang",
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 32768,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 256,
  trust_remote_code: true,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: null,
  host: "0.0.0.0",
  port: 8000,
  served_model_name: null,
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "conservative",
};

const fakeExecutable = (name: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "backend-builder-")), name);
  writeFileSync(path, "#!/bin/sh\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
};

describe("backend builder command overrides", () => {
  it("uses launch_command as the full launch argv", () => {
    const command = buildBackendCommand(
      {
        ...baseRecipe,
        extra_args: {
          launch_command:
            "python -m sglang.launch_server --model-path /models/custom --grammar-backend xgrammar",
        },
      },
      {} as Config
    );

    expect(command).toEqual([
      "python",
      "-m",
      "sglang.launch_server",
      "--model-path",
      "/models/custom",
      "--grammar-backend",
      "xgrammar",
    ]);
  });

  it("normalizes multiline command continuations from the editor", () => {
    const command = buildBackendCommand(
      {
        ...baseRecipe,
        extra_args: {
          launch_command:
            "python -m sglang.launch_server \\\n+  --model-path '/models/custom model' \\\n+  --enable-metrics",
        },
      },
      {} as Config
    );

    expect(command).toEqual([
      "python",
      "-m",
      "sglang.launch_server",
      "--model-path",
      "/models/custom model",
      "--enable-metrics",
    ]);
  });

  it("rejects shell interpreters for exllamav3 commands", () => {
    expect(() =>
      buildBackendCommand(
        {
          ...baseRecipe,
          backend: "exllamav3",
          extra_args: { exllama_command: "sh -c echo-pwned" },
        },
        {} as Config
      )
    ).toThrow("Invalid exllama_command");
  });

  it("accepts resolved ExLLaMA executables", () => {
    const executable = fakeExecutable("exllama-server");
    const command = buildBackendCommand(
      {
        ...baseRecipe,
        backend: "exllamav3",
        extra_args: { exllama_command: `"${executable}"` },
      },
      {} as Config
    );

    expect(command[0]).toBe(executable);
    expect(command).toContain("--model");
    expect(command).toContain("/models/test");
  });

  it("rejects non llama-server llama.cpp overrides", () => {
    expect(() =>
      buildBackendCommand(
        {
          ...baseRecipe,
          backend: "llamacpp",
          extra_args: { llama_bin: "/bin/sh" },
        },
        {} as Config
      )
    ).toThrow("Invalid llama_bin");
  });

  it("accepts resolved llama-server overrides", () => {
    const executable = fakeExecutable("llama-server");
    const command = buildBackendCommand(
      {
        ...baseRecipe,
        backend: "llamacpp",
        extra_args: { llama_bin: executable },
      },
      {} as Config
    );

    expect(command[0]).toBe(executable);
    expect(command).toContain("--model");
    expect(command).toContain("/models/test");
  });

  it("builds DS4 server commands with context and native extra args", () => {
    const executable = fakeExecutable("ds4-server");
    const command = buildBackendCommand(
      {
        ...baseRecipe,
        backend: "ds4",
        max_model_len: 100000,
        extra_args: {
          ds4_bin: executable,
          mtp: "/models/mtp.gguf",
          mtp_draft: 4,
          cuda: true,
          kv_disk_dir: "/tmp/ds4-kv",
          kv_disk_space_mb: 8192,
        },
      },
      {} as Config
    );

    expect(command).toEqual([
      executable,
      "--model",
      "/models/test",
      "--host",
      "0.0.0.0",
      "--port",
      "8000",
      "--ctx",
      "100000",
      "--mtp",
      "/models/mtp.gguf",
      "--mtp-draft",
      "4",
      "--cuda",
      "--kv-disk-dir",
      "/tmp/ds4-kv",
      "--kv-disk-space-mb",
      "8192",
    ]);
  });

  it("rejects non ds4-server DS4 overrides", () => {
    expect(() =>
      buildBackendCommand(
        {
          ...baseRecipe,
          backend: "ds4",
          extra_args: { ds4_bin: "/bin/sh" },
        },
        {} as Config
      )
    ).toThrow("Invalid ds4_bin");
  });
});
